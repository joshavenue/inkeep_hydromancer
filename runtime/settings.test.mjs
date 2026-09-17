import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveConfig } from './live-config.mjs';

test('deployed preview caps each model generation at 1200 output tokens', async (t) => {
  const cfg = await liveConfig(t, { manage: true });
  if (!cfg) return;
  const url = `${cfg.apiRoot}/manage/tenants/${cfg.tenantId}/projects/${cfg.projectId}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.INKEEP_AGENTS_MANAGE_API_BYPASS_SECRET}` } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.models.base.providerOptions.maxOutputTokens, 1200);
});
