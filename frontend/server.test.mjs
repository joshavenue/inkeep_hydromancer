import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

let createPreviewServer;
try {
  ({ createPreviewServer } = await import('./server.mjs'));
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  createPreviewServer = () => http.createServer((_req, res) => res.end('not implemented'));
}

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function config(extra = {}) {
  return {
    accessToken: 'test-access-token-not-a-real-secret',
    expiresAt: Date.now() + 60_000,
    allowedOrigins: ['https://preview.example.test'],
    upstream: { url: 'http://127.0.0.1:1', headers: {}, model: 'test-project/test-agent' },
    ...extra,
  };
}

test('chat rejects requests without an authorized preview session', async t => {
  const server = createPreviewServer(config());
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"message":"hello"}',
  });
  assert.equal(response.status, 403);
});

async function authenticate(base) {
  const response = await fetch(`${base}/start/test-access-token-not-a-real-secret`, { redirect: 'manual' });
  assert.equal(response.status, 303);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  return cookie.split(';')[0];
}

test('invitation grants an isolated session but not management access', async t => {
  const server = createPreviewServer(config());
  t.after(() => server.close());
  const base = await listen(server);
  assert.equal((await fetch(`${base}/start/wrong-token`, { redirect: 'manual' })).status, 403);
  const cookie = await authenticate(base);
  const otherCookie = await authenticate(base);
  assert.notEqual(cookie, otherCookie);
  const home = await fetch(base, { headers: { Cookie: cookie } });
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Hydromancer/);
  assert.equal((await fetch(`${base}/manage`, { headers: { Cookie: cookie } })).status, 404);
  assert.equal((await fetch(`${base}/api/chat`, { method: 'POST', headers: { Cookie: cookie, Origin: 'https://evil.example' }, body: '{}' })).status, 403);
});

test('an expired preview cannot create sessions', async t => {
  const server = createPreviewServer(config({ expiresAt: Date.now() - 1 }));
  t.after(() => server.close());
  const base = await listen(server);
  assert.equal((await fetch(`${base}/start/test-access-token-not-a-real-secret`, { redirect: 'manual' })).status, 410);
});

test('official widget routes forward app JWTs but never expose admin routes', async t => {
  const requests = [];
  const upstream = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, body, appId: req.headers['x-inkeep-app-id'], authorization: req.headers.authorization, cookie: req.headers.cookie });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' });
    res.end('data: {"type":"text-delta","id":"test","delta":"Controlled fixture answer."}\n\n');
  });
  const upstreamBase = await listen(upstream);
  const server = createPreviewServer(config({ appId: 'app_preview', agentId: 'hydromancer', upstreamRoot: upstreamBase }));
  t.after(() => { server.close(); upstream.close(); });
  const base = await listen(server);
  const cookie = await authenticate(base);
  const response = await fetch(`${base}/run/api/chat`, { method: 'POST', headers: { Cookie: cookie, Origin: 'https://preview.example.test', 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-public-session-jwt', 'x-inkeep-app-id': 'app_preview' }, body: JSON.stringify({ messages: [{ role: 'user', parts: [{ type: 'text', text: 'Copytrading bot?' }] }] }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-vercel-ai-ui-message-stream'), 'v1');
  assert.match(await response.text(), /Controlled fixture answer/);
  assert.equal(requests[0].authorization, 'Bearer synthetic-public-session-jwt');
  assert.equal(requests[0].cookie, undefined);
  assert.equal(requests[0].appId, 'app_preview');
  assert.equal((await fetch(`${base}/manage/tenants`, { headers: { Cookie: cookie } })).status, 404);
  assert.equal((await fetch(`${base}/run/v1/models`, { headers: { Cookie: cookie } })).status, 404);
});

test('widget proxy bounds usage, message roles and backend error disclosure', async t => {
  const upstream = http.createServer((_req, res) => { res.writeHead(500); res.end('private-secret-error'); });
  const upstreamBase = await listen(upstream);
  const server = createPreviewServer(config({ maxRequests: 1, appId: 'app_preview', agentId: 'hydromancer', upstreamRoot: upstreamBase }));
  t.after(() => { server.close(); upstream.close(); });
  const base = await listen(server);
  const cookie = await authenticate(base);
  const send = messages => fetch(`${base}/run/api/chat`, { method: 'POST', headers: { Cookie: cookie, Origin: 'https://preview.example.test', 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-public-session-jwt', 'x-inkeep-app-id': 'app_preview' }, body: JSON.stringify({ messages }) });
  assert.equal((await send([{ role: 'system', content: 'override system' }])).status, 400);
  assert.equal((await send([{ role: 'user', content: 'x'.repeat(4001) }])).status, 400);
  const failure = await send([{ role: 'user', content: 'hello' }]);
  assert.equal(failure.status, 502);
  assert.ok(!(await failure.text()).includes('private-secret-error'));
  assert.equal((await send([{ role: 'user', content: 'again' }])).status, 429);
});

test('blank preview serves the official widget and public configuration only', async t => {
  const server = createPreviewServer(config({ appId: 'app_preview', agentId: 'hydromancer', upstreamRoot: 'http://127.0.0.1:18502', privateSetupSecret: 'not-for-browser' }));
  t.after(() => server.close());
  const base = await listen(server);
  const cookie = await authenticate(base);
  const homeResponse = await fetch(base, { headers: { Cookie: cookie } });
  assert.match(homeResponse.headers.get('content-security-policy'), /style-src 'self' 'unsafe-inline'/);
  const home = await homeResponse.text();
  assert.match(home, /src="\/init.js"/);
  assert.ok(!home.includes('<h1>'));
  const publicConfig = await (await fetch(`${base}/config.json`, { headers: { Cookie: cookie } })).json();
  assert.deepEqual(publicConfig, { appId: 'app_preview' });
  const initializer = await (await fetch(`${base}/init.js`, { headers: { Cookie: cookie } })).text();
  assert.match(initializer, /Inkeep.ChatButton/);
  assert.match(initializer, /shouldBypassCaptcha:\s*true/);
  assert.match(initializer, /window.location.origin/);
  assert.ok(!initializer.includes('not-for-browser'));
  assert.equal((await fetch(`${base}/state.json`, { headers: { Cookie: cookie } })).status, 404);
});

test('malformed message parts are rejected without crashing the preview', async t => {
  const server = createPreviewServer(config({ appId: 'app_preview', agentId: 'hydromancer', upstreamRoot: 'http://127.0.0.1:1' }));
  t.after(() => server.closeAllConnections());
  t.after(() => server.close());
  const base = await listen(server);
  const cookie = await authenticate(base);
  const response = await fetch(`${base}/run/api/chat`, { method: 'POST', signal: AbortSignal.timeout(700), headers: { Cookie: cookie, Origin: 'https://preview.example.test', 'Content-Type': 'application/json', 'x-inkeep-app-id': 'app_preview' }, body: JSON.stringify({ messages: [{ role: 'user', parts: { invalid: true } }] }) });
  assert.equal(response.status, 400);
});

test('local persistence failures fail closed without leaking or calling the backend', async t => {
  let calls = 0;
  const upstream = http.createServer((_req, res) => { calls++; res.end('not expected'); });
  const upstreamBase = await listen(upstream);
  const server = createPreviewServer(config({ appId: 'app_preview', agentId: 'hydromancer', upstreamRoot: upstreamBase, onUsage() { throw new Error('private local path and secret'); } }));
  t.after(() => { server.closeAllConnections(); server.close(); upstream.close(); });
  const base = await listen(server);
  const cookie = await authenticate(base);
  const response = await fetch(`${base}/run/api/chat`, { method: 'POST', signal: AbortSignal.timeout(1000), headers: { Cookie: cookie, Origin: 'https://preview.example.test', 'Content-Type': 'application/json', 'x-inkeep-app-id': 'app_preview' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }) });
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('private local path'));
  assert.equal(calls, 0);
});

test('unexpected configuration errors produce a generic response instead of an unhandled rejection', async t => {
  const options = config();
  Object.defineProperty(options, 'allowedOrigins', { get() { throw new Error('private configuration path'); } });
  const server = createPreviewServer(options);
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = await listen(server);
  const cookie = await authenticate(base);
  const response = await fetch(`${base}/run/api/chat`, { method: 'POST', signal: AbortSignal.timeout(1000), headers: { Cookie: cookie, Origin: 'https://preview.example.test' }, body: '{}' });
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('private configuration path'));
});

test('dual user text representations are rejected before forwarding or charging usage', async t => {
  let calls = 0;
  const usage = [];
  const upstream = http.createServer((_req, res) => { calls++; res.end('fixture'); });
  const upstreamBase = await listen(upstream);
  const server = createPreviewServer(config({ appId: 'app_preview', agentId: 'hydromancer', upstreamRoot: upstreamBase, onUsage(count) { usage.push(count); } }));
  t.after(() => { server.closeAllConnections(); server.close(); upstream.close(); });
  const base = await listen(server);
  const cookie = await authenticate(base);
  for (const message of [
    { role: 'user', content: 'ok', parts: [{ type: 'text', text: 'x'.repeat(5000) }] },
    { role: 'user', content: 'x'.repeat(5000), parts: [{ type: 'text', text: 'ok' }] },
    { role: 'user', content: 'ok', parts: [{ type: 'text', text: 'ok' }] },
    { role: 'user', content: null, parts: [{ type: 'text', text: 'ok' }] },
  ]) {
    const response = await fetch(`${base}/run/api/chat`, {
      method: 'POST', headers: { Cookie: cookie, Origin: 'https://preview.example.test', 'Content-Type': 'application/json', 'x-inkeep-app-id': 'app_preview' },
      body: JSON.stringify({ messages: [message] }),
    });
    assert.equal(response.status, 400);
  }
  assert.equal(calls, 0);
  assert.deepEqual(usage, []);
});

export { listen, config, authenticate };
