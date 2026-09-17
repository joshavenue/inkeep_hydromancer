import test from 'node:test';
import assert from 'node:assert/strict';

// Synthetic fixtures only: no live gateway, credentials or model calls.
const env = {
  PREVIEW_UPSTREAM_ROOT: 'https://gateway.example.test',
  PREVIEW_INVITE_TOKEN: 'synthetic-invitation',
  PUBLIC_ORIGIN: 'https://preview.example.test',
  APP_ID: 'app_synthetic',
};
const now = () => Date.UTC(2030, 0, 1);
const token = 'a'.repeat(64);
const request = (path, init = {}) => new Request(`${env.PUBLIC_ORIGIN}${path}`, init);
const invite = (value = token) => new Response(null, { status: 303, headers: {
  location: '/',
  'set-cookie': `preview_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600`,
} });
async function factory(fetchImpl, options = {}) {
  const module = await import('../lib/preview-proxy.mjs').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  });
  assert.equal(typeof module.createPreviewProxy, 'function', 'a pure proxy factory exists');
  return module.createPreviewProxy(env, { fetchImpl, now, ...options });
}

const chatHeaders = { authorization: 'Bearer synthetic.jwt.fixture', origin: env.PUBLIC_ORIGIN, cookie: `preview_session=${token}`, 'x-inkeep-app-id': env.APP_ID, 'content-type': 'application/json' };

test('protected widget routes require native App JWTs while bootstrap routes can obtain them', async () => {
  let calls = 0;
  const handle = await factory(async () => { calls++; return Response.json({ token: 'synthetic.native.jwt' }); });
  const headers = { ...chatHeaders };
  delete headers.authorization;
  assert.equal((await handle(request('/api/run/api/chat', { method: 'POST', headers }))).status, 403);
  assert.equal(calls, 0);
  delete headers['x-inkeep-app-id'];
  const response = await handle(request(`/api/run/auth/apps/${env.APP_ID}/anonymous-session`, { method: 'POST', headers }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { token: 'synthetic.native.jwt' });
});

test('gateway invitation expiry retains 410 without issuing any session', async () => {
  let calls = 0;
  const handle = await factory(async () => { calls++; return Response.json({ error: 'expired' }, { status: 410 }); });
  const response = await handle(request('/api/config'));
  assert.equal(response.status, 410);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(calls, 1);
});

test('invalid fixed environment fails closed without network access', async () => {
  const { createPreviewProxy } = await import('../lib/preview-proxy.mjs');
  for (const overrides of [
    { PREVIEW_UPSTREAM_ROOT: 'http://gateway.example.test' },
    { PREVIEW_UPSTREAM_ROOT: 'https://user:password@gateway.example.test' },
    { PREVIEW_UPSTREAM_ROOT: 'https://gateway.example.test/private' },
    { PREVIEW_UPSTREAM_ROOT: 'https://127.0.0.1' },
    { PREVIEW_UPSTREAM_ROOT: 'https://localhost' },
    { PREVIEW_UPSTREAM_ROOT: 'https://gateway.example.test?root=evil' },
    { PUBLIC_ORIGIN: 'https://preview.example.test/' }, { PUBLIC_ORIGIN: '*' },
    { PREVIEW_INVITE_TOKEN: '' }, { PREVIEW_INVITE_TOKEN: '../escape' },
    { APP_ID: '' }, { APP_ID: 'wrong_app' },
  ]) {
    let calls = 0;
    const handle = createPreviewProxy({ ...env, ...overrides }, { fetchImpl: async () => { calls++; return invite(); } });
    const response = await handle(request('/api/config'));
    assert.equal(response.status, 503, JSON.stringify(overrides));
    assert.equal(calls, 0);
    assert.doesNotMatch(await response.text(), /password|synthetic-invitation/);
  }
});

test('cookie lifetime cannot extend the gateway deadline during slow config requests', async () => {
  let time = now();
  const handle = await factory(async url => {
    time += 1000;
    return String(url).includes('/start/') ? invite() : Response.json({ appId: env.APP_ID });
  }, { now: () => time });
  const response = await handle(request('/api/config'));
  assert.match(response.headers.get('set-cookie'), /Max-Age=3598;/);
  assert.match(response.headers.get('set-cookie'), /Expires=Tue, 01 Jan 2030 01:00:00 GMT/);
});

test('oversized config response is rejected without releasing a session cookie', async () => {
  const handle = await factory(async url => String(url).includes('/start/') ? invite() : Response.json({ appId: env.APP_ID, padding: 'a'.repeat(8193) }));
  const response = await handle(request('/api/config'));
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('abort before fetch, while reading POST and on response cancellation stops work', { timeout: 1000 }, async () => {
  let calls = 0;
  let upstreamSignal;
  let cancelled = false;
  const handle = await factory(async (url, init) => {
    calls++; upstreamSignal = init.signal;
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  });
  const before = new AbortController(); before.abort();
  assert.equal((await handle(request('/api/config', { signal: before.signal }))).status, 499);
  assert.equal(calls, 0);
  const during = new AbortController();
  const pending = handle(request('/api/run/api/chat', { method: 'POST', headers: chatHeaders, signal: during.signal, duplex: 'half', body: new ReadableStream() }));
  during.abort();
  assert.equal((await pending).status, 499);
  assert.equal(calls, 0);
  const response = await handle(request('/api/run/api/chat', { method: 'POST', headers: chatHeaders }));
  assert.ok(upstreamSignal instanceof AbortSignal);
  await response.body.cancel();
  assert.equal(upstreamSignal.aborted, true);
  assert.equal(cancelled, true);
});

test('deadline aborts pending fetch with a safe 504', { timeout: 1000 }, async () => {
  // A referenced timer keeps the test alive; Node timeout signals are unref'd.
  const keepAlive = setTimeout(() => {}, 900);
  try {
    const handle = await factory(async (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    }), { timeoutMs: 20 });
    assert.equal((await handle(request('/api/config'))).status, 504);
  } finally { clearTimeout(keepAlive); }
});

test('a failing streamed response exposes only a generic stream error', async () => {
  const handle = await factory(async () => new Response(new ReadableStream({ pull(c) { c.error(new Error('private stream detail')); } })));
  const response = await handle(request('/api/run/api/chat', { method: 'POST', headers: chatHeaders }));
  assert.equal(response.status, 200);
  await assert.rejects(response.text(), error => error.message === 'The preview stream ended.');
});

test('POST body limit is 96000 bytes, including chunked bodies, before upstream fetch', async () => {
  let calls = 0;
  const handle = await factory(async () => { calls++; return new Response('ok'); });
  for (const body of ['a'.repeat(96001), 'é'.repeat(48001), new ReadableStream({ start(c) { c.enqueue(new Uint8Array(48000)); c.enqueue(new Uint8Array(48001)); c.close(); } })]) {
    const response = await handle(request('/api/run/api/chat', { method: 'POST', headers: chatHeaders, body, duplex: 'half' }));
    assert.equal(response.status, 413);
  }
  assert.equal(calls, 0);
  const response = await handle(request('/api/run/api/chat', { method: 'POST', headers: chatHeaders, body: 'a'.repeat(96000) }));
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});

test('run errors retain safe statuses but never redirects, cookies, raw errors or automatic retries', async () => {
  for (const status of [301, 302, 303, 307, 308, 401, 403, 410, 429, 500, 503]) {
    let calls = 0;
    const handle = await factory(async () => { calls++; return new Response('private upstream detail', { status, headers: { location: 'https://evil.test', 'set-cookie': 'bad=bad' } }); });
    const response = await handle(request('/api/run/api/chat', { method: 'POST', headers: chatHeaders }));
    assert.equal(response.status, status >= 400 && status < 500 ? status : 502);
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.doesNotMatch(await response.text(), /private upstream detail/);
    assert.equal(calls, 1);
  }
  const handle = await factory(async () => { throw new Error('unpublishable details'); });
  const response = await handle(request('/api/run/api/chat', { method: 'POST', headers: chatHeaders }));
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /unpublishable/);
});

test('only supported widget routes and their safe query parameters reach the gateway', async () => {
  const calls = [];
  const handle = await factory(async (url, init) => {
    calls.push({ url: String(url), ...init });
    return Response.json({ token: 'synthetic.native.jwt' }, { status: 201 });
  });
  const cases = [
    ['POST', `/run/auth/apps/${env.APP_ID}/anonymous-session`, ''],
    ['GET', `/run/auth/challenge?appId=${env.APP_ID}&evil=drop`, `?appId=${env.APP_ID}`],
    ['GET', '/run/v1/conversations?limit=25&page=2&tenantId=drop&cursor=drop', '?page=2&limit=25'],
    ['GET', '/run/v1/conversations/synthetic-id?limit=25&evil=drop', ''],
    ['POST', '/run/v1/events?evil=drop', ''], ['POST', '/run/v1/feedback', ''],
  ];
  for (const [method, path, query] of cases) {
    const response = await handle(request(`/api${path}`, { method, headers: chatHeaders }));
    assert.equal(response.status, 201, path);
    assert.deepEqual(await response.json(), { token: 'synthetic.native.jwt' });
    assert.equal(calls.at(-1).url, `${env.PREVIEW_UPSTREAM_ROOT}${path.split('?')[0]}${query}`);
    assert.equal(calls.at(-1).method, method);
  }
  for (const path of [
    '/api/run/auth/challenge', '/api/run/auth/challenge?appId=app_wrong',
    `/api/run/auth/challenge?appId=${env.APP_ID}&appId=app_wrong`,
    '/api/run/v1/conversations?page=-1', '/api/run/v1/conversations?limit=101',
    '/api/run/v1/conversations?page=1&page=2', '/api/run/v1/conversations?limit=1.5',
  ]) assert.equal((await handle(request(path, { headers: chatHeaders }))).status, 400, path);
  assert.equal(calls.length, cases.length);
  for (const path of ['/api/run/v1/conversations', `/api/run/auth/challenge?appId=${env.APP_ID}`]) {
    assert.equal((await handle(request(path))).status, 403);
    assert.equal((await handle(request(path, { headers: { ...chatHeaders, origin: 'https://evil.test' } }))).status, 403);
  }
  assert.equal(calls.length, cases.length);
});

test('route and browser boundary deny unknown APIs, wrong origins and absent sessions before fetch', async () => {
  let calls = 0;
  const handle = await factory(async () => { calls++; return Response.json({ appId: env.APP_ID }); });
  const cases = [
    ['/api/manage', {}, 404], ['/api/start/synthetic-invitation', {}, 404],
    ['/api/config', { method: 'POST', headers: chatHeaders }, 404],
    ['/api/run/api/chat', { method: 'GET', headers: chatHeaders }, 404],
    ['/api/run/v1/conversations/valid/extra', {}, 404],
    ['/api/run/auth/apps/app_wrong/anonymous-session', { method: 'POST', headers: chatHeaders }, 404],
    ['/api/config', { headers: { origin: 'https://evil.test' } }, 403],
    ['/api/config', { headers: { 'sec-fetch-site': 'cross-site' } }, 403],
    ['/api/config', { headers: { 'sec-fetch-site': 'same-site' } }, 403],
    ['/api/run/api/chat', { method: 'POST', headers: { ...chatHeaders, origin: 'null' } }, 403],
    ['/api/run/api/chat', { method: 'POST', headers: { ...chatHeaders, origin: '' } }, 403],
    ['/api/run/api/chat', { method: 'POST', headers: { ...chatHeaders, origin: 'https://evil.test' } }, 403],
    ['/api/run/api/chat', { method: 'POST', headers: { ...chatHeaders, cookie: '' } }, 403],
    ['/api/run/api/chat', { method: 'POST', headers: { ...chatHeaders, cookie: `preview_session=${token}; preview_session=${token}` } }, 403],
    ['/api/run/api/chat', { method: 'POST', headers: { ...chatHeaders, cookie: 'preview_session=malformed' } }, 403],
    ['/api/run/api/chat', { method: 'POST', headers: { ...chatHeaders, 'x-inkeep-app-id': 'app_wrong' } }, 403],
    ['/api/run/api/chat', { method: 'POST', headers: { ...chatHeaders, authorization: 'Basic disallowed' } }, 403],
    ['/api/run/api/chat', { method: 'POST', headers: { ...chatHeaders, authorization: '' } }, 403],
  ];
  for (const [path, init, status] of cases) {
    const response = await handle(request(path, init));
    assert.equal(response.status, status, `${init.method ?? 'GET'} ${path} ${JSON.stringify(init.headers)}`);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(calls, 0);
});

test('chat forwards only widget credentials to fixed gateway and streams SSE unchanged', { timeout: 1000 }, async () => {
  const chunks = ['data: {"delta":"héllo"}\n\n', 'data: [DONE]\n\n'];
  let source;
  const body = new ReadableStream({ start(controller) { source = controller; } });
  const calls = [];
  const handle = await factory(async (url, init) => {
    calls.push({ url: String(url), ...init });
    return new Response(body, { status: 200, headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'x-vercel-ai-ui-message-stream': 'v1', 'x-inkeep-conversation-id': 'synthetic-conversation',
      'set-cookie': 'unrelated=never-forward', 'access-control-allow-origin': '*',
      'x-secret': 'never-forward', 'content-length': '999',
    } });
  });
  const response = await handle(request('/api/run/api/chat?upstream=https://attacker.test', {
    method: 'POST', headers: { origin: env.PUBLIC_ORIGIN, cookie: `other=drop; preview_session=${token}`,
      authorization: 'Bearer synthetic.jwt.fixture', 'content-type': 'application/json',
      'x-inkeep-app-id': env.APP_ID, 'x-altcha-spam-filter': 'synthetic-proof',
      'x-api-key': 'drop', 'x-forwarded-host': 'attacker.test', referer: 'https://attacker.test' },
    body: '{"messages":[]}',
  }));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${env.PREVIEW_UPSTREAM_ROOT}/run/api/chat`);
  assert.equal(calls[0].redirect, 'manual');
  assert.deepEqual(Object.fromEntries(new Headers(calls[0].headers)), {
    authorization: 'Bearer synthetic.jwt.fixture', 'content-type': 'application/json',
    cookie: `preview_session=${token}`, origin: env.PREVIEW_UPSTREAM_ROOT,
    'x-altcha-spam-filter': 'synthetic-proof', 'x-inkeep-app-id': env.APP_ID,
  });
  assert.equal(new TextDecoder().decode(calls[0].body), '{"messages":[]}');
  assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  assert.equal(response.headers.get('x-vercel-ai-ui-message-stream'), 'v1');
  assert.equal(response.headers.get('x-inkeep-conversation-id'), 'synthetic-conversation');
  for (const header of ['set-cookie', 'access-control-allow-origin', 'x-secret', 'content-length']) assert.equal(response.headers.get(header), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  // The handler returned while the upstream stream was still open.
  const reader = response.body.getReader();
  source.enqueue(new TextEncoder().encode(chunks[0]));
  assert.equal(new TextDecoder().decode((await reader.read()).value), chunks[0]);
  source.enqueue(new TextEncoder().encode(chunks[1]));
  source.close();
  assert.equal(new TextDecoder().decode((await reader.read()).value), chunks[1]);
  assert.equal((await reader.read()).done, true);
});

test('config renews a stale session once, never retrying a newly issued session', async () => {
  for (const failsAgain of [false, true]) {
    const calls = [];
    const handle = await factory(async (url, init) => {
      calls.push({ url: String(url), ...init });
      if (String(url).includes('/start/')) return invite('b'.repeat(64));
      return calls.length === 1 || failsAgain
        ? Response.json({ privateError: 'do-not-reflect' }, { status: 403 })
        : Response.json({ appId: env.APP_ID });
    });
    const response = await handle(request('/api/config', { headers: { cookie: `preview_session=${token}` } }));
    assert.equal(response.status, failsAgain ? 403 : 200);
    assert.equal(calls.length, 3);
    assert.equal(new Headers(calls[2].headers).get('cookie'), `preview_session=${'b'.repeat(64)}`);
    assert.doesNotMatch(await response.text(), /do-not-reflect/);
    if (failsAgain) assert.equal(response.headers.get('set-cookie'), null);
  }
});

test('config rejects malformed invitations, redirects, config mismatches and raw errors', async () => {
  const broken = [
    () => new Response(null, { status: 302, headers: { location: '/', 'set-cookie': invite().headers.get('set-cookie') } }),
    () => new Response(null, { status: 303, headers: { location: 'https://other.test/', 'set-cookie': invite().headers.get('set-cookie') } }),
    () => invite('not-a-session'),
    () => new Response(null, { status: 303, headers: { location: '/', 'set-cookie': `preview_session=${token}; Max-Age=0` } }),
    () => new Response(null, { status: 303, headers: { location: '/', 'set-cookie': `preview_session=${token}; Max-Age=3600; Max-Age=9999` } }),
    () => { throw new Error('private upstream details'); },
  ];
  for (const answer of broken) {
    let calls = 0;
    const handle = await factory(async () => { calls++; return answer(); });
    const response = await handle(request('/api/config'));
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.equal(calls, 1);
    assert.doesNotMatch(await response.text(), /private|synthetic-invitation|gateway/);
  }
  for (const upstream of [Response.json({ appId: 'app_wrong' }), new Response('bad json'), new Response(null, { status: 307, headers: { location: 'https://other.test' } })]) {
    const handle = await factory(async () => upstream);
    const response = await handle(request('/api/config', { headers: { cookie: `preview_session=${token}` } }));
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('location'), null);
  }
});

test('config reuses each valid visitor cookie rather than a global session', async () => {
  const seen = [];
  const handle = await factory(async (url, init) => {
    assert.equal(String(url), `${env.PREVIEW_UPSTREAM_ROOT}/config.json`);
    seen.push(new Headers(init.headers).get('cookie'));
    return Response.json({ appId: env.APP_ID });
  });
  for (const value of [token, 'b'.repeat(64)]) {
    const response = await handle(request('/api/config', { headers: { cookie: `other=ignored; preview_session=${value}` } }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.deepEqual(seen, [token, 'b'.repeat(64)].map(value => `preview_session=${value}`));
});

test('cold config redeems the invitation privately and returns only public app config', async () => {
  const calls = [];
  const handle = await factory(async (url, init) => {
    calls.push({ url: String(url), ...init });
    return calls.length === 1 ? invite() : Response.json({ appId: env.APP_ID, privateField: 'must-not-escape' });
  });
  const response = await handle(request('/api/config'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { appId: env.APP_ID });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `${env.PREVIEW_UPSTREAM_ROOT}/start/synthetic-invitation`);
  assert.equal(calls[0].redirect, 'manual');
  assert.equal(calls[1].url, `${env.PREVIEW_UPSTREAM_ROOT}/config.json`);
  assert.equal(new Headers(calls[1].headers).get('cookie'), `preview_session=${token}`);
  assert.equal(response.headers.get('set-cookie'), `preview_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600; Expires=Tue, 01 Jan 2030 01:00:00 GMT`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
