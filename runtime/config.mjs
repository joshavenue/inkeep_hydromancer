export const API_ROOT = 'http://127.0.0.1:18502';
export const TENANT_ID = 'hydromancer-preview';
export const PROJECT_ID = 'hydromancer-public';
export const AGENT_ID = 'hydromancer-assistant';
export const DOCS_URL = 'http://127.0.0.1:18581/mcp';
export const LOCAL_DOMAINS = ['127.0.0.1:18580', 'localhost:18580'];

export function modelConfig(env = process.env) {
  let url;
  try { url = new URL(env.MODEL_BASE_URL); }
  catch { throw new Error('Set MODEL_BASE_URL explicitly to an OpenAI-compatible Chat Completions endpoint.'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) {
    throw new Error('MODEL_BASE_URL must be HTTPS (or loopback HTTP), without embedded credentials, query or fragment.');
  }
  if (!env.CUSTOM_LLM_API_KEY?.trim() && !(loopback && env.MODEL_ALLOW_UNAUTHENTICATED_LOOPBACK === '1')) {
    throw new Error('Set server-only CUSTOM_LLM_API_KEY; keyless loopback requires MODEL_ALLOW_UNAUTHENTICATED_LOOPBACK=1.');
  }
  return {
    model: `custom/${env.MODEL_ID || 'grok-4.6'}`,
    providerOptions: { baseURL: url.href.replace(/\/$/, ''), contextWindowSize: 500000, maxOutputTokens: 1200 },
  };
}
