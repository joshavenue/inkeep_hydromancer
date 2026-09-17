import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createPreviewProxy } from '../lib/preview-proxy.mjs';

test('real HTTP transport keeps simultaneous cold visitors isolated and streams before EOF', { timeout: 5000 }, async t => {
  // Local protocol fixture only, not the running gateway or an Inkeep/model service.
  const sessions = new Set();
  let finishStream;
  const server = http.createServer((req, res) => {
    if (req.url === '/start/synthetic-invitation') {
      const token = String(sessions.size + 1).padStart(64, '0');
      sessions.add(`preview_session=${token}`);
      res.writeHead(303, { location: '/', 'set-cookie': `preview_session=${token}; Max-Age=600` });
      return res.end();
    }
    if (!sessions.has(req.headers.cookie)) { res.writeHead(403); return res.end(); }
    if (req.url === '/config.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ appId: 'app_synthetic' }));
    }
    if (req.url === '/run/api/chat') {
      assert.equal(req.headers.origin, 'https://gateway.example.test');
      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' });
      res.write('data: first\n\n');
      finishStream = () => res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(404); res.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const localRoot = `http://127.0.0.1:${server.address().port}`;
  const handle = createPreviewProxy({
    PREVIEW_UPSTREAM_ROOT: 'https://gateway.example.test', PREVIEW_INVITE_TOKEN: 'synthetic-invitation',
    PUBLIC_ORIGIN: 'https://inkeeptest.vercel.app', APP_ID: 'app_synthetic',
  }, { fetchImpl: (url, init) => fetch(`${localRoot}${new URL(url).pathname}`, init) });
  const visitors = await Promise.all([1, 2].map(() => handle(new Request('https://inkeeptest.vercel.app/api/config'))));
  assert.deepEqual(visitors.map(response => response.status), [200, 200]);
  const cookies = visitors.map(response => response.headers.get('set-cookie').split(';')[0]);
  assert.notEqual(cookies[0], cookies[1]);
  assert.equal(sessions.size, 2);
  for (const cookie of cookies) {
    const reused = await handle(new Request('https://inkeeptest.vercel.app/api/config', { headers: { cookie } }));
    assert.equal(reused.status, 200);
    assert.equal(reused.headers.get('set-cookie'), null);
  }
  assert.equal(sessions.size, 2, 'reused cookies must not mint sessions');
  const response = await handle(new Request('https://inkeeptest.vercel.app/api/run/api/chat', {
    method: 'POST', body: '{}', headers: {
      cookie: cookies[0], origin: 'https://inkeeptest.vercel.app', 'content-type': 'application/json',
      'x-inkeep-app-id': 'app_synthetic', authorization: 'Bearer synthetic.jwt.fixture',
    },
  }));
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n');
  finishStream();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: [DONE]\n\n');
  assert.equal((await reader.read()).done, true);
});
