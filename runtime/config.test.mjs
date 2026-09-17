import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';

const setup = new URL('./scripts/setup-local.mjs', import.meta.url);
test('server refuses to start without explicit model selection before loading Inkeep or opening ports', () => {
  const run = spawnSync(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], { env: {}, encoding: 'utf8', timeout: 5000 });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Set MODEL_BASE_URL explicitly/);
  assert.doesNotMatch(run.stderr, /ERR_MODULE_NOT_FOUND/);
});
test('model config requires an explicit safe endpoint; never serializes server credentials', async () => {
  assert.ok(existsSync(new URL('./config.mjs', import.meta.url)), 'validated configuration module must exist');
  const { modelConfig } = await import('./config.mjs');
  assert.throws(() => modelConfig({}), /MODEL_BASE_URL/);
  const env = { MODEL_BASE_URL: 'https://provider.example/v1', CUSTOM_LLM_API_KEY: 'synthetic-offline-test-key' };
  assert.deepEqual(modelConfig(env), {
    model: 'custom/grok-4.6',
    providerOptions: { baseURL: env.MODEL_BASE_URL, contextWindowSize: 500000, maxOutputTokens: 1200 },
  });
  assert.ok(!JSON.stringify(modelConfig(env)).includes(env.CUSTOM_LLM_API_KEY));
  for (const url of ['http://provider.example/v1', 'https://user:password@provider.example/v1', 'https://provider.example/v1?key=secret', 'https://provider.example/v1#secret', 'file:///tmp/model']) {
    assert.throws(() => modelConfig({ ...env, MODEL_BASE_URL: url }), /MODEL_BASE_URL/);
  }
  assert.throws(() => modelConfig({ MODEL_BASE_URL: env.MODEL_BASE_URL }), /CUSTOM_LLM_API_KEY/);
  assert.throws(() => modelConfig({ MODEL_BASE_URL: env.MODEL_BASE_URL, MODEL_ALLOW_UNAUTHENTICATED_LOOPBACK: '1' }), /CUSTOM_LLM_API_KEY/);
  assert.equal(modelConfig({ MODEL_BASE_URL: 'http://127.0.0.1:18545/v1', MODEL_ALLOW_UNAUTHENTICATED_LOOPBACK: '1' }).model, 'custom/grok-4.6');
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
    assert.equal(env.MODEL_BASE_URL, '', 'no implicit external endpoint or old local proxy');
    assert.equal(env.MODEL_ID, 'grok-4.6');
    assert.equal(env.CUSTOM_LLM_API_KEY, '');
    assert.equal(env.TENANT_ID, 'hydromancer-preview');
    assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600);
    assert.doesNotMatch(text, /app_[a-z0-9]+/);
    assert.notEqual(run().status, 0);
    assert.equal(readFileSync(join(dir, '.env'), 'utf8'), text);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
