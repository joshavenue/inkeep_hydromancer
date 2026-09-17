import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveConfig } from './live-config.mjs';

test('actual released Inkeep server is healthy', async (t) => {
  const cfg = await liveConfig(t, {});
  if (!cfg) return;
  assert.equal((await fetch(`${cfg.apiRoot}/health`)).status, 204);
});
test('unauthenticated management is rejected', async (t) => {
  const cfg = await liveConfig(t, {});
  if (!cfg) return;
  assert.equal((await fetch(cfg.manageAppUrl)).status, 401);
});
test('anonymous session rejects an unapproved origin', async (t) => {
  const cfg = await liveConfig(t, {});
  if (!cfg) return;
  const r = await fetch(`${cfg.apiRoot}/run/auth/apps/${cfg.appId}/anonymous-session`, { method: 'POST', headers: { Origin: 'https://unapproved.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
});
test('approved origin receives native anonymous session', async (t) => {
  const cfg = await liveConfig(t, {});
  if (!cfg) return;
  const r = await fetch(`${cfg.apiRoot}/run/auth/apps/${cfg.appId}/anonymous-session`, { method: 'POST', headers: { Origin: 'http://127.0.0.1:18580', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 200);
  const data=await r.json();
  assert.equal(typeof data.token, 'string');
  assert.ok(data.expiresAt);
});
