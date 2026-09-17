import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

// All configuration, management responses and credentials here are synthetic.
function fixture(t, { blockedLogs = false, invalidReadback = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'inkeep-origin-offline-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const moduleDir = join(root, 'module');
  const cwd = join(root, 'working/runtime');
  mkdirSync(moduleDir);
  mkdirSync(cwd, { recursive: true });
  mkdirSync(join(root, 'working/frontend'));
  const script = join(moduleDir, 'authorize-preview-origin.mjs');
  copyFileSync(new URL('./authorize-preview-origin.mjs', import.meta.url), script);
  const logs = join(moduleDir, 'logs');
  if (blockedLogs) writeFileSync(logs, 'synthetic obstruction');
  const cfg = { appId: 'app_offlinefixture', manageAppUrl: 'https://management.invalid/app_offlinefixture', allowedDomains: ['localhost:18580'] };
  const clientFile = join(cwd, 'preview-client.json');
  const originalClient = JSON.stringify(cfg);
  writeFileSync(clientFile, originalClient, { mode: 0o600 });
  writeFileSync(join(root, 'working/frontend/state.json'), JSON.stringify({ publishedOrigin: 'https://synthetic-preview.trycloudflare.com' }));
  const callsFile = join(root, 'calls.json');
  writeFileSync(callsFile, '[]');
  const mockFile = join(root, 'mock-fetch.mjs');
  writeFileSync(mockFile, `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    const calls = [];
    let app = { id: 'app_offlinefixture', config: { type: 'web_client', webClient: { allowedDomains: ['localhost:18580'], allowAnonymous: false } } };
    globalThis.fetch = async (url, options = {}) => {
      assert.equal(url, ${JSON.stringify(cfg.manageAppUrl)});
      assert.equal(options.headers.Authorization, 'Bearer synthetic-management-secret');
      const method = options.method ?? 'GET';
      calls.push({ method, privateLogsReady: fs.existsSync(${JSON.stringify(logs)}) && fs.statSync(${JSON.stringify(logs)}).isDirectory() && (fs.statSync(${JSON.stringify(logs)}).mode & 0o777) === 0o700 });
      fs.writeFileSync(${JSON.stringify(callsFile)}, JSON.stringify(calls));
      if (method === 'PATCH') {
        app.config = JSON.parse(options.body).config;
        assert.deepEqual(app.config.webClient.allowedDomains, ['localhost:18580', 'synthetic-preview.trycloudflare.com']);
        assert.equal(app.config.webClient.allowAnonymous, true);
        return Response.json({ data: app });
      }
      assert.equal(method, 'GET');
      if (${invalidReadback} && calls.length > 1) app.config.webClient.allowAnonymous = false;
      return Response.json({ data: app });
    };
  `);
  const run = spawnSync(process.execPath, ['--import', pathToFileURL(mockFile).href, script], {
    cwd, env: { INKEEP_AGENTS_MANAGE_API_BYPASS_SECRET: 'synthetic-management-secret' }, encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(run.error);
  return { run, logs, cwd, clientFile, originalClient, calls: JSON.parse(readFileSync(callsFile, 'utf8')) };
}

test('origin authorization creates private module-relative logs before PATCH on a fresh setup', (t) => {
  const f = fixture(t);
  assert.equal(f.run.status, 0, f.run.stderr);
  assert.deepEqual(f.calls.map(call => call.method), ['GET', 'PATCH', 'GET']);
  assert.equal(f.calls.find(call => call.method === 'PATCH').privateLogsReady, true);
  assert.equal(statSync(f.logs).mode & 0o777, 0o700);
  assert.equal(existsSync(join(f.cwd, 'logs')), false, 'logs must be anchored to the module, not cwd');
  const receipt = JSON.parse(readFileSync(join(f.logs, 'public-app-verification.json'), 'utf8'));
  assert.deepEqual(receipt, {
    appId: 'app_offlinefixture', allowedDomains: ['localhost:18580', 'synthetic-preview.trycloudflare.com'], allowAnonymous: true, readbackStatus: 200,
  });
  assert.deepEqual(JSON.parse(f.run.stdout), receipt);
  const client = readFileSync(f.clientFile, 'utf8');
  assert.deepEqual(JSON.parse(client).allowedDomains, receipt.allowedDomains);
  assert.ok(!client.includes('synthetic-management-secret'));
  assert.equal(statSync(f.clientFile).mode & 0o777, 0o600);
});

test('origin authorization cannot mutate management when creating its log directory fails', (t) => {
  const f = fixture(t, { blockedLogs: true });
  assert.equal(f.calls.some(call => call.method === 'PATCH'), false, 'failed mkdir must precede management mutation');
  assert.notEqual(f.run.status, 0);
  assert.match(f.run.stderr, /EEXIST|ENOTDIR/);
  assert.equal(readFileSync(f.clientFile, 'utf8'), f.originalClient);
});

test('origin authorization still rejects an invalid GET readback without saving client or receipt', (t) => {
  const f = fixture(t, { invalidReadback: true });
  assert.notEqual(f.run.status, 0);
  assert.match(f.run.stderr, /AssertionError/);
  assert.deepEqual(f.calls.map(call => call.method), ['GET', 'PATCH', 'GET']);
  assert.equal(readFileSync(f.clientFile, 'utf8'), f.originalClient);
  assert.equal(existsSync(join(f.logs, 'public-app-verification.json')), false);
});
