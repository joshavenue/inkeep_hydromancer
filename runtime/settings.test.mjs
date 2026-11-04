import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveConfig } from './live-config.mjs';
import { DEFAULT_MODEL, MAX_OUTPUT_TOKENS } from './config.mjs';

test('deployed project uses the configured light model with a small output cap and reasoning off', async (t) => {
  const cfg = await liveConfig(t, { manage: true });
  if (!cfg) return;
  const url = `${cfg.apiRoot}/manage/tenants/${cfg.tenantId}/projects/${cfg.projectId}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.INKEEP_AGENTS_MANAGE_API_BYPASS_SECRET}` } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.models.base.model, process.env.MODEL || DEFAULT_MODEL);
  assert.equal(body.data.models.base.providerOptions.maxOutputTokens, MAX_OUTPUT_TOKENS);
  if (body.data.models.base.model.startsWith('openai/')) assert.equal(body.data.models.base.providerOptions.openai.reasoningEffort, 'none');
});
