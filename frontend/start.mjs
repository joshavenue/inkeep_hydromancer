import { readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createPreviewServer } from './server.mjs';

const stateFile = new URL('./state.json', import.meta.url);
const clientFile = new URL('../runtime/preview-client.json', import.meta.url);
let state;
try {
  state = JSON.parse(readFileSync(stateFile, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  state = { accessToken: randomBytes(32).toString('hex'), expiresAt: Date.now() + 6 * 60 * 60 * 1000, usedRequests: 0, publishedOrigin: null };
  writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600, flag: 'wx' });
}
if (!state || typeof state !== 'object' || Array.isArray(state)
    || typeof state.accessToken !== 'string' || !/^[a-f0-9]{64}$/.test(state.accessToken)
    || !Number.isSafeInteger(state.expiresAt) || state.expiresAt <= 0 || state.expiresAt > 8_640_000_000_000_000
    || !Number.isSafeInteger(state.usedRequests) || state.usedRequests < 0) {
  throw new Error('Invalid preview state; refusing to reset persisted access or limits.');
}
if (state.publishedOrigin !== null) {
  const origin = typeof state.publishedOrigin === 'string' ? URL.parse(state.publishedOrigin) : null;
  if (!origin || !['http:', 'https:'].includes(origin.protocol) || origin.origin !== state.publishedOrigin) {
    throw new Error('Invalid preview state publishedOrigin.');
  }
}
chmodSync(stateFile, 0o600);
const client = () => {
  try { return JSON.parse(readFileSync(clientFile, 'utf8')); } catch { return {}; }
};
const config = {
  accessToken: state.accessToken,
  expiresAt: state.expiresAt,
  usedRequests: state.usedRequests,
  maxRequests: 40,
  upstreamRoot: 'http://127.0.0.1:18502',
  get appId() { return client().appId; },
  get agentId() { return client().agentId; },
  get allowedOrigins() {
    const current = JSON.parse(readFileSync(stateFile, 'utf8'));
    return ['http://127.0.0.1:18580', 'http://localhost:18580', current.publishedOrigin].filter(Boolean);
  },
  onUsage(count) {
    const current = JSON.parse(readFileSync(stateFile, 'utf8'));
    const temporary = new URL('./state.next.json', import.meta.url);
    writeFileSync(temporary, JSON.stringify({ ...current, usedRequests: count }, null, 2), { mode: 0o600 });
    renameSync(temporary, stateFile);
  },
};
const server = createPreviewServer(config);
server.listen(18580, '127.0.0.1', () => console.log(JSON.stringify({ service: 'hydromancer-inkeep-preview', bind: '127.0.0.1:18580', expiresAt: new Date(state.expiresAt).toISOString() })));
setTimeout(() => {
  server.closeAllConnections();
  server.close(() => process.exit(0));
}, Math.max(1, state.expiresAt - Date.now()));
