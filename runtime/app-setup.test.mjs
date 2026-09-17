import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('App metadata is not saved when readback changes scope, enablement or domains', async () => {
  const { createLocalApp } = await import('./scripts/create-local-app.mjs');
  const root = mkdtempSync(join(tmpdir(), 'inkeep-app-readback-'));
  try {
    for (const change of [
      app => { app.enabled = false; },
      app => { app.tenantId = 'another-tenant'; },
      app => { app.projectId = 'another-project'; },
      app => { app.defaultAgentId = 'another-agent'; },
      app => { app.defaultProjectId = 'another-project'; },
      app => { app.config.webClient.allowAnonymous = false; },
      app => { app.config.webClient.allowedDomains = ['*']; },
    ]) {
      let app;
      const clientFile = join(root, 'client.json');
      const fetchImpl = async (url, options) => {
        if (options.method === 'POST') {
          app = { ...JSON.parse(options.body), id: 'app_offlinefixture' };
          return Response.json({ data: { app } }, { status: 201 });
        }
        change(app);
        return Response.json({ data: app });
      };
      await assert.rejects(createLocalApp({ clientFile, fetchImpl, env: { INKEEP_AGENTS_MANAGE_API_BYPASS_SECRET: 'test-only' } }));
      assert.equal(existsSync(clientFile), false);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('App creation writes only verified fresh metadata, keeps secrets server-side and refuses overwrite', async () => {
  assert.ok(existsSync(new URL('./scripts/create-local-app.mjs', import.meta.url)), 'fresh App setup is required');
  const { createLocalApp } = await import('./scripts/create-local-app.mjs');
  const root = mkdtempSync(join(tmpdir(), 'inkeep-app-'));
  const clientFile = join(root, 'preview-client.json');
  const secret = 'synthetic-server-only-secret';
  let app;
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method });
    assert.ok(url.startsWith('http://127.0.0.1:18502/manage/'));
    assert.equal(options.headers.Authorization, `Bearer ${secret}`);
    assert.equal(options.redirect, 'error');
    if (options.method === 'POST') {
      app = { ...JSON.parse(options.body), id: 'app_offlinefixture' };
      assert.equal(app.enabled, true);
      assert.equal(app.config.webClient.allowAnonymous, true);
      assert.deepEqual(app.config.webClient.allowedDomains, ['127.0.0.1:18580', 'localhost:18580']);
      return Response.json({ data: { app } }, { status: 201 });
    }
    assert.ok(url.endsWith('/app_offlinefixture'));
    return Response.json({ data: app });
  };
  try {
    await createLocalApp({ clientFile, fetchImpl, env: { INKEEP_AGENTS_MANAGE_API_BYPASS_SECRET: secret } });
    assert.deepEqual(calls.map(c => c.method), ['POST', 'GET']);
    const text = readFileSync(clientFile, 'utf8');
    assert.ok(!text.includes(secret));
    const cfg = JSON.parse(text);
    assert.equal(cfg.appId, app.id);
    assert.equal(cfg.agentId, 'hydromancer-assistant');
    assert.equal(cfg.manageAppUrl, calls[1].url);
    assert.equal(statSync(clientFile).mode & 0o777, 0o600);
    await assert.rejects(createLocalApp({ clientFile, fetchImpl, env: { INKEEP_AGENTS_MANAGE_API_BYPASS_SECRET: secret } }), /overwrite/);
    assert.equal(calls.length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
