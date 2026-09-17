import http from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function createPreviewServer(config) {
  const sessions = new Map();
  let usedRequests = config.usedRequests ?? 0;
  let activeRequests = 0;
  const handleRequest = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; worker-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (Date.now() >= config.expiresAt) return json(res, 410, { error: 'This temporary preview has expired.' });
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && path.startsWith('/start/')) {
      const supplied = Buffer.from(path.slice(7));
      const expected = Buffer.from(config.accessToken);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        return json(res, 403, { error: 'Invalid preview invitation.' });
      }
      const token = randomBytes(32).toString('hex');
      sessions.set(token, { conversationId: randomUUID(), turns: 0, recent: [], inFlight: false });
      res.writeHead(303, { Location: '/', 'Set-Cookie': `preview_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor((config.expiresAt - Date.now()) / 1000)}` });
      return res.end();
    }
    const token = req.headers.cookie?.match(/(?:^|;\s*)preview_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    const session = sessions.get(token);
    if (!session) return json(res, 403, { error: 'Use your private preview invitation link.' });
    if (req.method === 'POST' && !config.allowedOrigins.includes(req.headers.origin)) {
      return json(res, 403, { error: 'Origin not allowed.' });
    }
    if (req.method === 'GET' && path === '/config.json') {
      if (!config.appId) return json(res, 503, { error: 'The preview is still starting.' });
      return json(res, 200, { appId: config.appId });
    }
    if (req.method === 'GET' && ['/', '/init.js', '/embed.js'].includes(path)) {
      const filename = path === '/' ? 'index.html' : path.slice(1);
      res.writeHead(200, { 'Content-Type': path === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' });
      return res.end(readFileSync(new URL(`./public/${filename}`, import.meta.url)));
    }
    const requestUrl = new URL(req.url, 'http://localhost');
    const isChat = req.method === 'POST' && path === '/run/api/chat';
    const isAnon = req.method === 'POST' && path === `/run/auth/apps/${config.appId}/anonymous-session`;
    const isChallenge = req.method === 'GET' && path === '/run/auth/challenge' && requestUrl.searchParams.get('appId') === config.appId;
    const isHistory = req.method === 'GET' && /^\/run\/v1\/conversations(?:\/[A-Za-z0-9_-]{1,160})?$/.test(path);
    const isFeedback = req.method === 'POST' && ['/run/v1/events', '/run/v1/feedback'].includes(path);
    if (!(isChat || isAnon || isChallenge || isHistory || isFeedback)) {
      return json(res, 404, { error: 'Not found.' });
    }
    if (!config.appId || !config.upstreamRoot) return json(res, 503, { error: 'The preview is still starting.' });
    if (!(isAnon || isChallenge) && req.headers['x-inkeep-app-id'] !== config.appId) {
      return json(res, 403, { error: 'App not allowed.' });
    }
    let body;
    if (req.method === 'POST') {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 96_000) return json(res, 413, { error: 'Request too large.' });
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks).toString('utf8');
    }
    if (isChat) {
      let payload;
      try { payload = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid request.' }); }
      if (!payload || !Array.isArray(payload.messages) || !payload.messages.length || payload.messages.length > 40) {
        return json(res, 400, { error: 'Invalid messages.' });
      }
      for (const message of payload.messages) {
        if (!message || !['user', 'assistant'].includes(message.role)) return json(res, 400, { error: 'Only chat messages are allowed.' });
        if (message.role === 'user') {
          if (Object.hasOwn(message, 'content') && Object.hasOwn(message, 'parts')) {
            return json(res, 400, { error: 'Use either content or parts, not both.' });
          }
          if (message.parts !== undefined && (!Array.isArray(message.parts) || message.parts.some(p => !p || typeof p.type !== 'string' || (p.type === 'text' && typeof p.text !== 'string')))) {
            return json(res, 400, { error: 'Invalid message parts.' });
          }
          const text = typeof message.content === 'string' ? message.content : (message.parts ?? []).filter(p => p.type === 'text').map(p => p.text).join('');
          if (!text || text.length > 4000 || (message.parts ?? []).some(p => p.type !== 'text')) {
            return json(res, 400, { error: 'Use a text question of at most 4,000 characters.' });
          }
        }
      }
      if (['tools', 'tool_choice', 'system', 'systemPrompt', 'headers', 'apiKey', 'tenantId', 'projectId', 'agentId'].some(key => key in payload) || (payload.model && payload.model !== config.agentId)) {
        return json(res, 400, { error: 'Agent configuration cannot be changed from the preview.' });
      }
      session.recent = session.recent.filter(ts => ts > Date.now() - 60_000);
      if (usedRequests >= (config.maxRequests ?? 40) || session.turns >= 20 || session.recent.length >= 8 || session.inFlight || activeRequests >= 2) {
        return json(res, 429, { error: 'Preview limit reached or a reply is still running. Please try later.' });
      }
      usedRequests++;
      session.turns++;
      session.recent.push(Date.now());
      session.inFlight = true;
      activeRequests++;
    }
    try {
      if (isChat) config.onUsage?.(usedRequests);
      const headers = { Origin: req.headers.origin ?? config.allowedOrigins[0], 'x-inkeep-app-id': config.appId };
      if (req.headers.authorization) headers.Authorization = req.headers.authorization;
      if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
      if (req.headers['x-altcha-spam-filter']) headers['x-altcha-spam-filter'] = req.headers['x-altcha-spam-filter'];
      const upstream = await fetch(`${config.upstreamRoot}${path}${requestUrl.search}`, {
        method: req.method, headers, ...(req.method === 'POST' ? { body } : {}), signal: AbortSignal.timeout(180_000), redirect: 'error',
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        return json(res, upstream.status >= 500 ? 502 : upstream.status, { error: 'The assistant could not complete this request. Please retry or start a new chat.' });
      }
      const outHeaders = {};
      for (const name of ['content-type', 'x-vercel-ai-ui-message-stream', 'x-vercel-ai-data-stream', 'x-inkeep-conversation-id']) {
        if (upstream.headers.has(name)) outHeaders[name] = upstream.headers.get(name);
      }
      res.writeHead(upstream.status, outHeaders);
      if (upstream.body) for await (const chunk of upstream.body) {
        if (res.destroyed) break;
        res.write(chunk);
      }
      res.end();
    } catch {
      if (!res.headersSent) json(res, 502, { error: 'The assistant is temporarily unavailable. Please retry.' });
      else res.end();
    } finally {
      if (isChat) { session.inFlight = false; activeRequests--; }
    }
  };
  return http.createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      if (res.destroyed || res.writableEnded) return;
      if (!res.headersSent) json(res, 503, { error: 'The preview is temporarily unavailable.' });
      else res.end();
    });
  });
}
