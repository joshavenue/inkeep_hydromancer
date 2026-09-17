import { isIP } from 'node:net';

function json(status, body, extra = {}) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...extra } });
}
const failure = (status = 502) => json(status, { error: 'The preview is unavailable. Please reload later.' });
async function discard(response) {
  await response.body?.cancel().catch(() => {});
}
function errorStatus(status) {
  return status >= 400 && status < 500 ? status : 502;
}

class RequestFailure extends Error {
  constructor(status) { super('Invalid request'); this.status = status; }
}
async function readBody(stream, limit, signal) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  const chunks = [];
  let size = 0;
  try {
    signal.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new RequestFailure(413);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error instanceof RequestFailure ? error : new RequestFailure(400);
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

function streamResponse(body, signal, abortController) {
  if (!body) return null;
  const reader = body.getReader();
  let closed = false;
  let onAbort;
  const finish = () => { closed = true; signal.removeEventListener('abort', onAbort); };
  return new ReadableStream({
    start(controller) {
      onAbort = () => {
        if (closed) return;
        finish();
        void reader.cancel().catch(() => {});
        controller.error(new Error('The preview stream ended.'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    },
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (closed) return;
        if (done) { finish(); controller.close(); }
        else controller.enqueue(value);
      } catch {
        if (closed) return;
        finish();
        abortController.abort();
        controller.error(new Error('The preview stream ended.'));
      }
    },
    async cancel() {
      finish();
      abortController.abort();
      await reader.cancel().catch(() => {});
    },
  }, { highWaterMark: 0 });
}

export function createPreviewProxy(env, { fetchImpl = fetch, now = Date.now, timeoutMs = 190_000 } = {}) {
  // Only deployment-controlled, canonical HTTPS public origins are accepted.
  // DNS and the tunnel itself remain operator-owned; never accept a target from requests.
  try {
    const upstream = new URL(env.PREVIEW_UPSTREAM_ROOT);
    const origin = new URL(env.PUBLIC_ORIGIN);
    const publicHost = url => url.hostname.includes('.') && !isIP(url.hostname)
      && !url.hostname.startsWith('[') && !/(?:^|\.)(localhost|local|internal)$/.test(url.hostname);
    if (upstream.protocol !== 'https:' || !publicHost(upstream)
      || ![upstream.origin, `${upstream.origin}/`].includes(env.PREVIEW_UPSTREAM_ROOT)
      || origin.protocol !== 'https:' || !publicHost(origin) || origin.origin !== env.PUBLIC_ORIGIN
      || !/^[A-Za-z0-9_-]{1,256}$/.test(env.PREVIEW_INVITE_TOKEN ?? '')
      || !/^app_[A-Za-z0-9_-]{1,160}$/.test(env.APP_ID ?? '')) throw new Error('Invalid environment');
    env = { ...env, PREVIEW_UPSTREAM_ROOT: upstream.origin };
  } catch { return async () => failure(503); }

  async function redeem(signal) {
    const startedAt = now();
    const response = await fetchImpl(`${env.PREVIEW_UPSTREAM_ROOT}/start/${env.PREVIEW_INVITE_TOKEN}`, { redirect: 'manual', signal });
    await discard(response);
    if (response.status !== 303) throw new RequestFailure(errorStatus(response.status));
    if (response.headers.get('location') !== '/') throw new Error('Invalid invitation response');
    const cookies = response.headers.getSetCookie();
    if (cookies.length !== 1) throw new Error('Invalid cookie response');
    const parts = cookies[0].split(';').map(part => part.trim());
    const value = parts[0].match(/^preview_session=([a-f0-9]{64})$/)?.[1];
    const ages = parts.filter(part => /^max-age=/i.test(part));
    if (!value || ages.length !== 1 || !/^max-age=[1-9]\d{0,7}$/i.test(ages[0])) throw new Error('Invalid cookie lifetime');
    const deadline = startedAt + Number(ages[0].split('=')[1]) * 1000;
    const age = Math.floor((deadline - now()) / 1000);
    if (age <= 0) throw new Error('Expired cookie');
    return { value, deadline };
  }
  const getConfig = (value, signal) => fetchImpl(`${env.PREVIEW_UPSTREAM_ROOT}/config.json`, {
    redirect: 'manual', signal, headers: { cookie: `preview_session=${value}` },
  });
  return async function handle(request) {
    const controller = new AbortController();
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([request.signal, deadline, controller.signal]);
    try {
      signal.throwIfAborted();
      const url = new URL(request.url);
      const path = url.pathname;
      const isConfig = request.method === 'GET' && path === '/api/config';
      const isChat = request.method === 'POST' && path === '/api/run/api/chat';
      const isAnon = request.method === 'POST' && path === `/api/run/auth/apps/${env.APP_ID}/anonymous-session`;
      const isChallenge = request.method === 'GET' && path === '/api/run/auth/challenge';
      const isHistory = request.method === 'GET' && /^\/api\/run\/v1\/conversations(?:\/[A-Za-z0-9_-]{1,160})?$/.test(path);
      const isFeedback = request.method === 'POST' && ['/api/run/v1/events', '/api/run/v1/feedback'].includes(path);
      if (!(isConfig || isChat || isAnon || isChallenge || isHistory || isFeedback)) return failure(404);
      const origin = request.headers.get('origin');
      const site = request.headers.get('sec-fetch-site');
      if ((request.method === 'POST' ? origin !== env.PUBLIC_ORIGIN : origin !== null && origin !== env.PUBLIC_ORIGIN)
        || (site !== null && !['same-origin', 'none'].includes(site))) return failure(403);
      const cookies = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith('preview_session='));
      let value = cookies.length === 1 ? cookies[0].match(/^preview_session=([a-f0-9]{64})$/)?.[1] : undefined;
      if (!isConfig) {
        const appHeader = request.headers.get('x-inkeep-app-id');
        if (!value || (appHeader !== null && appHeader !== env.APP_ID)
          || (!(isAnon || isChallenge) && appHeader !== env.APP_ID)) return failure(403);
        const query = new URLSearchParams();
        if (isChallenge) {
          if (url.searchParams.getAll('appId').length !== 1 || url.searchParams.get('appId') !== env.APP_ID) return failure(400);
          query.set('appId', env.APP_ID);
        }
        if (isHistory && path === '/api/run/v1/conversations') {
          for (const [name, max] of [['page', 10000], ['limit', 100]]) {
            const values = url.searchParams.getAll(name);
            if (values.length > 1 || (values.length && (!/^[1-9]\d{0,4}$/.test(values[0]) || Number(values[0]) > max))) return failure(400);
            if (values.length) query.set(name, values[0]);
          }
        }
        const auth = request.headers.get('authorization');
        if ((auth === null && !(isAnon || isChallenge))
          || (auth !== null && !/^(?:Bearer|AppJWT) [A-Za-z0-9._~-]+$/.test(auth))) return failure(403);
        const headers = new Headers({ cookie: `preview_session=${value}`, origin: env.PREVIEW_UPSTREAM_ROOT });
        for (const name of ['authorization', 'content-type', 'x-inkeep-app-id', 'x-altcha-spam-filter']) {
          if (request.headers.has(name)) headers.set(name, request.headers.get(name));
        }
        const upstream = await fetchImpl(`${env.PREVIEW_UPSTREAM_ROOT}${path.slice(4)}${query.size ? `?${query}` : ''}`, {
          method: request.method, headers, redirect: 'manual', signal,
          ...(request.method === 'POST' ? { body: await readBody(request.body, 96_000, signal) } : {}),
        });
        if (!upstream.ok) { await discard(upstream); return failure(errorStatus(upstream.status)); }
        const out = new Headers({ 'cache-control': 'no-store' });
        for (const name of ['content-type', 'x-vercel-ai-ui-message-stream', 'x-vercel-ai-data-stream', 'x-inkeep-conversation-id']) {
          if (upstream.headers.has(name)) out.set(name, upstream.headers.get(name));
        }
        return new Response(streamResponse(upstream.body, signal, controller), { status: upstream.status, headers: out });
      }
      let issued;
      if (!value) { issued = await redeem(signal); value = issued.value; }
      let upstream = await getConfig(value, signal);
      if (!issued && [401, 403].includes(upstream.status)) {
        await discard(upstream);
        issued = await redeem(signal);
        upstream = await getConfig(issued.value, signal);
      }
      if (!upstream.ok) { await discard(upstream); return failure(errorStatus(upstream.status)); }
      let config;
      try { config = JSON.parse(new TextDecoder().decode(await readBody(upstream.body, 8192, signal))); }
      catch { signal.throwIfAborted(); return failure(); }
      if (config?.appId !== env.APP_ID) return failure();
      const extra = {};
      if (issued) {
        const age = Math.floor((issued.deadline - now()) / 1000);
        if (age <= 0) return failure(410);
        extra['set-cookie'] = `preview_session=${issued.value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}; Expires=${new Date(issued.deadline).toUTCString()}`;
      }
      return json(200, { appId: env.APP_ID }, extra);
    } catch (error) {
      controller.abort();
      return failure(request.signal.aborted ? 499 : deadline.aborted ? 504 : error instanceof RequestFailure ? error.status : 502);
    }
  };
}
