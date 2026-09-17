import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { API_ROOT, TENANT_ID, PROJECT_ID, AGENT_ID, LOCAL_DOMAINS } from '../config.mjs';

export async function createLocalApp({
  env = process.env, fetchImpl = globalThis.fetch,
  clientFile = new URL('../preview-client.json', import.meta.url),
} = {}) {
  if (existsSync(clientFile)) throw new Error('Refusing to overwrite preview-client.json or create a duplicate App.');
  if (!env.INKEEP_AGENTS_MANAGE_API_BYPASS_SECRET) throw new Error('Server-only INKEEP_AGENTS_MANAGE_API_BYPASS_SECRET is required.');
  const appsUrl = `${API_ROOT}/manage/tenants/${TENANT_ID}/projects/${PROJECT_ID}/apps`;
  const headers = { Authorization: `Bearer ${env.INKEEP_AGENTS_MANAGE_API_BYPASS_SECRET}`, 'Content-Type': 'application/json' };
  const payload = {
    tenantId: TENANT_ID, projectId: PROJECT_ID,
    name: 'Local Hydromancer docs demo', description: 'Anonymous loopback-only web client for the public-docs demo.',
    type: 'web_client', enabled: true, defaultAgentId: AGENT_ID, defaultProjectId: PROJECT_ID,
    config: { type: 'web_client', webClient: { allowedDomains: LOCAL_DOMAINS, allowAnonymous: true } },
  };
  const created = await fetchImpl(appsUrl, { method: 'POST', headers, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (created.status !== 201) throw new Error(`App creation failed (HTTP ${created.status}); response body omitted for credential safety.`);
  const id = (await created.json()).data?.app?.id;
  if (!/^app_[A-Za-z0-9_-]+$/.test(id || '')) throw new Error('Creation returned an invalid App ID.');
  const manageAppUrl = `${appsUrl}/${id}`;
  const response = await fetchImpl(manageAppUrl, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`App readback failed (HTTP ${response.status}). Do not blindly rerun creation.`);
  const app = (await response.json()).data;
  assert.equal(app?.id, id, 'App readback must match the newly created App');
  for (const field of ['tenantId', 'projectId', 'type', 'enabled', 'defaultAgentId', 'defaultProjectId']) {
    assert.equal(app[field], payload[field], `App readback mismatch: ${field}`);
  }
  assert.equal(app.config?.type, 'web_client');
  assert.equal(app.config.webClient?.allowAnonymous, true);
  assert.deepEqual([...(app.config.webClient.allowedDomains ?? [])].sort(), [...LOCAL_DOMAINS].sort());
  const config = {
    apiRoot: API_ROOT, tenantId: TENANT_ID, projectId: PROJECT_ID, agentId: AGENT_ID,
    appId: id, manageAppUrl, allowedDomains: app.config.webClient.allowedDomains,
  };
  writeFileSync(clientFile, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return config;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3 || process.argv[2] !== '--create-anonymous-app') {
    console.error('Explicit opt-in required: node --env-file=.env scripts/create-local-app.mjs --create-anonymous-app');
    process.exitCode = 1;
  } else {
    try {
      await createLocalApp();
      console.log('Verified new local Web Client App; wrote private preview-client.json. No model called.');
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
