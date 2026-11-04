export const API_ROOT = 'http://127.0.0.1:18502';
export const TENANT_ID = 'hydromancer-preview';
export const PROJECT_ID = 'hydromancer-public';
export const AGENT_ID = 'hydromancer-assistant';
export const DOCS_URL = 'http://127.0.0.1:18581/mcp';
export const LOCAL_DOMAINS = ['127.0.0.1:18580', 'localhost:18580'];

// Cheapest model that still handles tool calls and citations reliably, billed
// through the team's OpenRouter account: gpt-6-luna at $0.10 per 1M input and
// $0.50 per 1M output (OpenRouter passes OpenAI's list price through). Reasoning
// is switched off and output is capped, so one answered question costs about a
// tenth of a cent. See runtime/README.md for alternatives.
export const DEFAULT_MODEL = 'openrouter/openai/gpt-6-luna';
export const MAX_OUTPUT_TOKENS = 700;
export const EFFORT_OUTPUT_TOKENS = 4000; // room for thinking when ANTHROPIC_EFFORT is set
export const CONTEXT_WINDOW = 1_000_000;

const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,80}(\/[a-z0-9][a-z0-9._-]{0,80})?$/i;

function parseModel(value) {
  const match = /^([a-z]+)\/(.+)$/.exec((value ?? '').trim());
  if (!match || !MODEL_ID.test(match[2])) throw new Error('MODEL must look like provider/model-id, for example openrouter/openai/gpt-6-luna.');
  return { provider: match[1], id: match[2] };
}

export function modelConfig(env = process.env) {
  const { provider, id } = parseModel(env.MODEL || DEFAULT_MODEL);
  const providerOptions = { contextWindowSize: CONTEXT_WINDOW, maxOutputTokens: MAX_OUTPUT_TOKENS };
  if (provider === 'openrouter') {
    if (!env.OPENROUTER_API_KEY?.trim()) throw new Error('Set server-only OPENROUTER_API_KEY for the openrouter/ provider.');
    // OpenRouter forwards reasoning settings to the underlying model; "none" keeps
    // gpt-6-luna from billing reasoning tokens (verified 4 Nov 2026: 0 reasoning tokens).
    providerOptions.openrouter = { reasoning: { effort: 'none' } };
    return { model: `openrouter/${id}`, providerOptions };
  }
  if (provider === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY?.trim()) throw new Error('Set server-only ANTHROPIC_API_KEY for the anthropic/ provider.');
    // Claude Haiku 5.5: $0.10 / 1M input, $0.50 / 1M output for prompts under 100k
    // tokens (Anthropic list price, 4 Nov 2026), the same rate as gpt-6-luna.
    // Haiku 5.5 enables adaptive thinking by default once a tool result is in the
    // conversation; measured 4 Nov 2026, it then spent 230-300 thinking tokens and
    // re-searched instead of answering, leaving 1 in 4 answers empty. Disabling it
    // makes the model answer in one step and removes billed thinking tokens.
    // ANTHROPIC_EFFORT=high|medium|low turns adaptive thinking back on at that
    // effort (Anthropic output_config.effort, beta header). Thinking tokens are
    // billed as output and count against the output cap, so the cap rises with it.
    const effort = (env.ANTHROPIC_EFFORT ?? '').trim().toLowerCase();
    if (effort) {
      if (!['low', 'medium', 'high'].includes(effort)) throw new Error('ANTHROPIC_EFFORT must be low, medium or high.');
      providerOptions.maxOutputTokens = EFFORT_OUTPUT_TOKENS;
      providerOptions.anthropic = { effort };
    } else {
      providerOptions.anthropic = { thinking: { type: 'disabled' } };
    }
    return { model: `anthropic/${id}`, providerOptions };
  }
  if (provider === 'openai') {
    if (!env.OPENAI_API_KEY?.trim()) throw new Error('Set server-only OPENAI_API_KEY for the openai/ provider.');
    // Inkeep forwards object-valued provider options per call. GPT-6 Luna accepts
    // reasoning effort "none"; forceReasoning makes the SDK send it for a gpt-6 id.
    providerOptions.openai = { forceReasoning: true, reasoningEffort: 'none', textVerbosity: 'low' };
    return { model: `openai/${id}`, providerOptions };
  }
  if (provider === 'google') {
    if (!env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) throw new Error('Set server-only GOOGLE_GENERATIVE_AI_API_KEY for the google/ provider.');
    providerOptions.google = { thinkingConfig: { thinkingBudget: 0 } };
    return { model: `google/${id}`, providerOptions };
  }
  if (provider !== 'custom') throw new Error('MODEL provider must be openrouter, anthropic, openai, google or custom (OpenAI-compatible endpoint).');
  let url;
  try { url = new URL(env.MODEL_BASE_URL); }
  catch { throw new Error('Set MODEL_BASE_URL explicitly to an OpenAI-compatible Chat Completions endpoint for the custom/ provider.'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback))) {
    throw new Error('MODEL_BASE_URL must be HTTPS (or loopback HTTP), without embedded credentials, query or fragment.');
  }
  if (!env.CUSTOM_LLM_API_KEY?.trim() && !(loopback && env.MODEL_ALLOW_UNAUTHENTICATED_LOOPBACK === '1')) {
    throw new Error('Set server-only CUSTOM_LLM_API_KEY; keyless loopback requires MODEL_ALLOW_UNAUTHENTICATED_LOOPBACK=1.');
  }
  providerOptions.baseURL = url.href.replace(/\/$/, '');
  // Sent as reasoning_effort by the OpenAI-compatible provider; harmless for models that ignore it.
  providerOptions.custom = { reasoningEffort: 'none' };
  return { model: `custom/${id}`, providerOptions };
}
