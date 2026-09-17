import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

test('missing model credentials or unavailable services skip instead of executing chat', async () => {
  const { liveConfig } = await import('./live-config.mjs');
  const client = { apiRoot: 'http://127.0.0.1:18502', appId: 'app_offlinefixture' };
  const reasons = [];
  const env = { INKEEP_LIVE_TESTS: '1', INKEEP_MODEL_TESTS: '1' };
  let requests = 0;
  const options = { env, model: true, readClient: () => client, fetchImpl: async () => { requests++; return { status: 204, ok: true }; } };
  assert.equal(await liveConfig({ skip: reason => reasons.push(reason) }, options), null);
  assert.match(reasons[0], /model configuration/i);
  assert.equal(requests, 0);
  reasons.length = 0;
  options.model = false;
  options.fetchImpl = async () => { throw new Error('synthetic unavailable service'); };
  assert.equal(await liveConfig({ skip: reason => reasons.push(reason) }, options), null);
  assert.match(reasons[0], /unavailable/);
});

test('live prerequisites perform no I/O without explicit opt-in', async () => {
  assert.ok(existsSync(new URL('./live-config.mjs', import.meta.url)), 'live prerequisite gate is required');
  const { liveConfig } = await import('./live-config.mjs');
  const reasons = [];
  const context = { skip: reason => reasons.push(reason) };
  const cfg = await liveConfig(context, { env: {}, readClient: () => assert.fail('must not read files'), fetchImpl: () => assert.fail('must not access network') });
  assert.equal(cfg, null);
  assert.match(reasons[0], /INKEEP_LIVE_TESTS/);
});

test('model tests need a separate paid-call opt-in before any network activity', async () => {
  const { liveConfig } = await import('./live-config.mjs');
  const reasons = [];
  const cfg = await liveConfig({ skip: reason => reasons.push(reason) }, {
    env: { INKEEP_LIVE_TESTS: '1' }, model: true,
    readClient: () => ({ apiRoot: 'http://127.0.0.1:18502', appId: 'app_offlinefixture' }),
    fetchImpl: () => assert.fail('model opt-in must precede service checks'),
  });
  assert.equal(cfg, null);
  assert.match(reasons[0], /INKEEP_MODEL_TESTS/);
});
