import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { API_ROOT, TENANT_ID, PROJECT_ID, AGENT_ID, LOCAL_DOMAINS } from '../config.mjs';

const APP_ID = /^app_[A-Za-z0-9_-]+$/;

function expectedPayload() {
  return {
    tenantId: TENANT_ID, projectId: PROJECT_ID,
    name: 'Local Hydromancer docs demo', description: 'Anonymous loopback-only web client for the public-docs demo.',
    type: 'web_client', enabled: true, defaultAgentId: AGENT_ID, defaultProjectId: PROJECT_ID,
    config: { type: 'web_client', webClient: { allowedDomains: LOCAL_DOMAINS, allowAnonymous: true } },
  };
}

// GET the App back through the tenant-scoped management URL and refuse to save
// anything unless scope, enablement, agent, anonymous mode and domains all match.
async function verifyApp({ id, appsUrl, headers, fetchImpl, clientFile }) {
  const payload = expectedPayload();
  const manageAppUrl = `${appsUrl}/${id}`;
  const response = await fetchImpl(manageAppUrl, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`App readback failed (HTTP ${response.status}). Do not blindly rerun creation.`);
  const app = (await response.json()).data;
  assert.equal(app?.id, id, 'App readback must match the requested App');
  // Released 0.80.6 omits tenantId from the App body; the tenant is fixed by the URL.
  if (app.tenantId !== undefined) assert.equal(app.tenantId, payload.tenantId, 'App readback mismatch: tenantId');
  for (const field of ['projectId', 'type', 'enabled', 'defaultAgentId', 'defaultProjectId']) {
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

function prepare(env, clientFile) {
  if (existsSync(clientFile)) throw new Error('Refusing to overwrite preview-client.json or create a duplicate App.');
  if (!env.INKEEP_AGENTS_MANAGE_API_BYPASS_SECRET) throw new Error('Server-only INKEEP_AGENTS_MANAGE_API_BYPASS_SECRET is required.');
  return {
    appsUrl: `${API_ROOT}/manage/tenants/${TENANT_ID}/projects/${PROJECT_ID}/apps`,
    headers: { Authorization: `Bearer ${env.INKEEP_AGENTS_MANAGE_API_BYPASS_SECRET}`, 'Content-Type': 'application/json' },
  };
}

export async function createLocalApp({
  env = process.env, fetchImpl = globalThis.fetch,
  clientFile = new URL('../preview-client.json', import.meta.url),
} = {}) {
  const { appsUrl, headers } = prepare(env, clientFile);
  const created = await fetchImpl(appsUrl, { method: 'POST', headers, body: JSON.stringify(expectedPayload()), redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (created.status !== 201) throw new Error(`App creation failed (HTTP ${created.status}); response body omitted for credential safety.`);
  const id = (await created.json()).data?.app?.id;
  if (!APP_ID.test(id || '')) throw new Error('Creation returned an invalid App ID.');
  return verifyApp({ id, appsUrl, headers, fetchImpl, clientFile });
}

// Adopt an App that already exists (for example when an earlier run created it but
// failed before saving metadata). Same readback checks, no POST.
export async function adoptLocalApp(id, {
  env = process.env, fetchImpl = globalThis.fetch,
  clientFile = new URL('../preview-client.json', import.meta.url),
} = {}) {
  if (!APP_ID.test(id || '')) throw new Error('Adopt requires an App ID like app_xxx.');
  const { appsUrl, headers } = prepare(env, clientFile);
  return verifyApp({ id, appsUrl, headers, fetchImpl, clientFile });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [, , command, argument] = process.argv;
  try {
    if (command === '--create-anonymous-app' && process.argv.length === 3) {
      await createLocalApp();
      console.log('Verified new local Web Client App; wrote private preview-client.json. No model called.');
    } else if (command === '--adopt-app' && process.argv.length === 4) {
      await adoptLocalApp(argument);
      console.log('Verified existing Web Client App; wrote private preview-client.json. No model called.');
    } else {
      console.error('Explicit opt-in required: --create-anonymous-app, or --adopt-app <app_id> for an App created earlier.');
      process.exitCode = 1;
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
