import { readFileSync, mkdirSync } from 'node:fs';
import { API_ROOT, modelConfig } from './config.mjs';

// No config file reads or network activity happen before the opt-in check.
export async function liveConfig(t, {
  model = false, manage = false, env = process.env,
  readClient = () => JSON.parse(readFileSync(new URL('./preview-client.json', import.meta.url), 'utf8')),
  fetchImpl = globalThis.fetch,
} = {}) {
  if (env.INKEEP_LIVE_TESTS !== '1') { t.skip('Set INKEEP_LIVE_TESTS=1 to contact local services.'); return null; }
  if (model && env.INKEEP_MODEL_TESTS !== '1') { t.skip('Set INKEEP_MODEL_TESTS=1 to permit potentially paid model calls.'); return null; }
  let selectedModel;
  if (model) {
    try { selectedModel = modelConfig(env); }
    catch { t.skip('Valid server-side model configuration/credentials absent.'); return null; }
  }
  let cfg;
  try { cfg = readClient(); }
  catch { t.skip('Generate preview-client.json after dedicated DB and App setup.'); return null; }
  if (cfg.apiRoot !== API_ROOT || !/^app_[A-Za-z0-9_-]+$/.test(cfg.appId || '')) {
    throw new Error('Live tests require a generated loopback preview-client.json.');
  }
  if (manage && !env.INKEEP_AGENTS_MANAGE_API_BYPASS_SECRET) { t.skip('Management credentials absent.'); return null; }
  try {
    const response = await fetchImpl(`${API_ROOT}/health`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
    if (response.status !== 204) { t.skip('Local Inkeep API is not healthy.'); return null; }
  } catch { t.skip('Local Inkeep API unavailable.'); return null; }
  if (model) {
    try {
      const docs = await fetchImpl('http://127.0.0.1:18581/health', { signal: AbortSignal.timeout(2000), redirect: 'error' });
      if (!docs.ok) { t.skip('Public-docs MCP not healthy.'); return null; }
      // GET /models is a reachability/auth preflight, not an inference request.
      const models = await fetchImpl(`${selectedModel.providerOptions.baseURL}/models`, {
        headers: env.CUSTOM_LLM_API_KEY ? { Authorization: `Bearer ${env.CUSTOM_LLM_API_KEY}` } : {},
        signal: AbortSignal.timeout(5000), redirect: 'error',
      });
      if (!models.ok) { t.skip('Model endpoint /models unavailable or unauthorized.'); return null; }
    } catch { t.skip('MCP or model endpoint unavailable.'); return null; }
    mkdirSync(new URL('./logs/', import.meta.url), { recursive: true, mode: 0o700 });
  }
  return cfg;
}
