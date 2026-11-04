import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';

const setup = new URL('./scripts/setup-local.mjs', import.meta.url);
test('server refuses to start without model credentials before loading Inkeep or opening ports', () => {
  const run = spawnSync(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], { env: {}, encoding: 'utf8', timeout: 5000 });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /OPENROUTER_API_KEY/);
  assert.doesNotMatch(run.stderr, /ERR_MODULE_NOT_FOUND/);
});
test('default model is gpt-6-luna through OpenRouter with reasoning off and a small output cap', async () => {
  assert.ok(existsSync(new URL('./config.mjs', import.meta.url)), 'validated configuration module must exist');
  const { modelConfig, DEFAULT_MODEL, MAX_OUTPUT_TOKENS } = await import('./config.mjs');
  assert.equal(DEFAULT_MODEL, 'openrouter/openai/gpt-6-luna');
  assert.ok(MAX_OUTPUT_TOKENS <= 800, 'answers stay short to keep output cost low');
  assert.throws(() => modelConfig({}), /OPENROUTER_API_KEY/);
  const env = { OPENROUTER_API_KEY: 'synthetic-offline-test-key' };
  assert.deepEqual(modelConfig(env), {
    model: 'openrouter/openai/gpt-6-luna',
    providerOptions: { contextWindowSize: 1_000_000, maxOutputTokens: MAX_OUTPUT_TOKENS, openrouter: { reasoning: { effort: 'none' } } },
  });
  assert.ok(!JSON.stringify(modelConfig(env)).includes(env.OPENROUTER_API_KEY));
  assert.equal(modelConfig({ ...env, MODEL: 'openrouter/google/gemini-2.5-flash-lite' }).model, 'openrouter/google/gemini-2.5-flash-lite');
  assert.throws(() => modelConfig({ ...env, MODEL: 'gpt-6-luna' }), /provider\/model-id/);
  assert.throws(() => modelConfig({ ...env, MODEL: 'openrouter/../secret' }), /provider\/model-id/);
  assert.throws(() => modelConfig({ ...env, MODEL: 'mistral/mistral-small' }), /provider must be/);
});
test('Anthropic provider needs its own key and disables adaptive thinking', async () => {
  const { modelConfig, MAX_OUTPUT_TOKENS } = await import('./config.mjs');
  assert.throws(() => modelConfig({ MODEL: 'anthropic/claude-haiku-5-5' }), /ANTHROPIC_API_KEY/);
  const env = { MODEL: 'anthropic/claude-haiku-5-5', ANTHROPIC_API_KEY: 'synthetic-offline-test-key' };
  assert.deepEqual(modelConfig(env), {
    model: 'anthropic/claude-haiku-5-5',
    providerOptions: { contextWindowSize: 1_000_000, maxOutputTokens: MAX_OUTPUT_TOKENS, anthropic: { thinking: { type: 'disabled' } } },
  });
  assert.ok(!JSON.stringify(modelConfig(env)).includes(env.ANTHROPIC_API_KEY));
  const high = modelConfig({ ...env, ANTHROPIC_EFFORT: 'high' });
  assert.deepEqual(high.providerOptions.anthropic, { effort: 'high' });
  assert.ok(high.providerOptions.maxOutputTokens >= 4000, 'thinking needs output headroom');
  assert.throws(() => modelConfig({ ...env, ANTHROPIC_EFFORT: 'max' }), /low, medium or high/);
});
test('direct OpenAI provider keeps reasoning off and low verbosity', async () => {
  const { modelConfig, MAX_OUTPUT_TOKENS } = await import('./config.mjs');
  assert.throws(() => modelConfig({ MODEL: 'openai/gpt-6-luna' }), /OPENAI_API_KEY/);
  const env = { MODEL: 'openai/gpt-6-luna', OPENAI_API_KEY: 'synthetic-offline-test-key' };
  assert.deepEqual(modelConfig(env), {
    model: 'openai/gpt-6-luna',
    providerOptions: {
      contextWindowSize: 1_000_000, maxOutputTokens: MAX_OUTPUT_TOKENS,
      openai: { forceReasoning: true, reasoningEffort: 'none', textVerbosity: 'low' },
    },
  });
  assert.ok(!JSON.stringify(modelConfig(env)).includes(env.OPENAI_API_KEY));
});
test('google provider disables thinking; custom provider keeps the strict endpoint rules', async () => {
  const { modelConfig } = await import('./config.mjs');
  assert.throws(() => modelConfig({ MODEL: 'google/gemini-2.5-flash-lite' }), /GOOGLE_GENERATIVE_AI_API_KEY/);
  const google = modelConfig({ MODEL: 'google/gemini-2.5-flash-lite', GOOGLE_GENERATIVE_AI_API_KEY: 'synthetic' });
  assert.equal(google.model, 'google/gemini-2.5-flash-lite');
  assert.deepEqual(google.providerOptions.google, { thinkingConfig: { thinkingBudget: 0 } });
  const custom = { MODEL: 'custom/grok-4.6', MODEL_BASE_URL: 'https://provider.example/v1', CUSTOM_LLM_API_KEY: 'synthetic-offline-test-key' };
  assert.throws(() => modelConfig({ MODEL: 'custom/grok-4.6' }), /MODEL_BASE_URL/);
  assert.deepEqual(modelConfig(custom), {
    model: 'custom/grok-4.6',
    providerOptions: { contextWindowSize: 1_000_000, maxOutputTokens: 700, baseURL: custom.MODEL_BASE_URL, custom: { reasoningEffort: 'none' } },
  });
  assert.ok(!JSON.stringify(modelConfig(custom)).includes(custom.CUSTOM_LLM_API_KEY));
  for (const url of ['http://provider.example/v1', 'https://user:password@provider.example/v1', 'https://provider.example/v1?key=secret', 'https://provider.example/v1#secret', 'file:///tmp/model']) {
    assert.throws(() => modelConfig({ ...custom, MODEL_BASE_URL: url }), /MODEL_BASE_URL/);
  }
  assert.throws(() => modelConfig({ MODEL: 'custom/grok-4.6', MODEL_BASE_URL: custom.MODEL_BASE_URL }), /CUSTOM_LLM_API_KEY/);
  assert.throws(() => modelConfig({ MODEL: 'custom/grok-4.6', MODEL_BASE_URL: custom.MODEL_BASE_URL, MODEL_ALLOW_UNAUTHENTICATED_LOOPBACK: '1' }), /CUSTOM_LLM_API_KEY/);
  assert.equal(modelConfig({ MODEL: 'custom/local-model', MODEL_BASE_URL: 'http://127.0.0.1:18545/v1', MODEL_ALLOW_UNAUTHENTICATED_LOOPBACK: '1' }).model, 'custom/local-model');
});
test('local setup generates private unique secrets, no App ID, and will not overwrite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inkeep-config-'));
  try {
    const run = () => spawnSync(process.execPath, [setup.pathname, '--directory', dir], { encoding: 'utf8' });
    const result = run();
    assert.equal(result.status, 0, 'local configuration generator should succeed');
    const text = readFileSync(join(dir, '.env'), 'utf8');
    const env = parseEnv(text);
    const names = ['BETTER_AUTH_SECRET', 'INKEEP_AGENTS_JWT_SIGNING_SECRET', 'INKEEP_AGENTS_MANAGE_API_BYPASS_SECRET', 'SPICEDB_PRESHARED_KEY', 'INKEEP_AGENTS_MANAGE_UI_PASSWORD'];
    const secrets = names.map(name => env[name]);
    assert.ok(secrets.every(value => value?.length >= 32));
    assert.equal(new Set(secrets).size, names.length);
    for (const value of secrets) assert.ok(!`${result.stdout}${result.stderr}`.includes(value));
    assert.equal(env.MODEL, 'openrouter/openai/gpt-6-luna');
    assert.equal(env.OPENROUTER_API_KEY, '', 'no credential is generated or assumed');
    assert.equal(env.OPENAI_API_KEY, '');
    assert.equal(env.MODEL_BASE_URL, '', 'no implicit external endpoint or old local proxy');
    assert.equal(env.CUSTOM_LLM_API_KEY, '');
    assert.equal(env.TENANT_ID, 'hydromancer-preview');
    assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600);
    assert.doesNotMatch(text, /app_[a-z0-9]+/);
    assert.notEqual(run().status, 0);
    assert.equal(readFileSync(join(dir, '.env'), 'utf8'), text);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
