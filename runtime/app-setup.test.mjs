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

test('readback accepts the released API shape without tenantId and adopt verifies an existing App', async () => {
  const { createLocalApp, adoptLocalApp } = await import('./scripts/create-local-app.mjs');
  const root = mkdtempSync(join(tmpdir(), 'inkeep-app-adopt-'));
  const env = { INKEEP_AGENTS_MANAGE_API_BYPASS_SECRET: 'test-only' };
  const existing = {
    id: 'app_existingfixture', projectId: 'hydromancer-public', type: 'web_client', enabled: true,
    defaultAgentId: 'hydromancer-assistant', defaultProjectId: 'hydromancer-public',
    config: { type: 'web_client', webClient: { allowAnonymous: true, allowedDomains: ['localhost:18580', '127.0.0.1:18580'] } },
  };
  try {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push(options.method);
      if (options.method === 'POST') return Response.json({ data: { app: { id: 'app_existingfixture' } } }, { status: 201 });
      assert.ok(url.endsWith('/apps/app_existingfixture'));
      return Response.json({ data: existing });
    };
    const created = await createLocalApp({ clientFile: join(root, 'a.json'), fetchImpl, env });
    assert.equal(created.appId, 'app_existingfixture');
    const adopted = await adoptLocalApp('app_existingfixture', { clientFile: join(root, 'b.json'), fetchImpl, env });
    assert.deepEqual(calls, ['POST', 'GET', 'GET'], 'adopt must not POST');
    assert.equal(adopted.appId, 'app_existingfixture');
    assert.equal(JSON.parse(readFileSync(join(root, 'b.json'), 'utf8')).agentId, 'hydromancer-assistant');
    await assert.rejects(adoptLocalApp('not-an-app', { clientFile: join(root, 'c.json'), fetchImpl, env }), /App ID/);
    const disabled = { ...existing, enabled: false };
    await assert.rejects(adoptLocalApp('app_existingfixture', { clientFile: join(root, 'd.json'), env, fetchImpl: async () => Response.json({ data: disabled }) }));
    assert.equal(existsSync(join(root, 'd.json')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
