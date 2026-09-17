import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { liveConfig } from './live-config.mjs';
import { isStreamError } from './sse-errors.mjs';
import crypto from 'node:crypto';

const origin = 'http://127.0.0.1:18580';

test('deployed project contains the scoped-Yes policy', async (t) => {
  const cfg = await liveConfig(t, { manage: true });
  if (!cfg) return;
  const url = `${cfg.apiRoot}/manage/tenants/${cfg.tenantId}/project-full/${cfg.projectId}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.INKEEP_AGENTS_MANAGE_API_BYPASS_SECRET}` } });
  assert.equal(response.status, 200);
  const graph = await response.json();
  assert.match(JSON.stringify(graph.data), /SUPPORTED_COMPONENT_YES/);
});

for (const c of [
  { id: 'copytrading', question: 'I want to build a Hyperliquid copytrading bot. I will handle trade execution separately. Is Hydromancer a fit?', verdict: /\bYes\b/i, scope: /data|fills|userFills/i },
  { id: 'nft-launch', question: 'I want to launch an NFT collection, deploy its NFT smart contract and mint NFTs. Can the Hydromancer API do that?', verdict: /\bNo\b/i, scope: /NFT|mint|contract/i },
]) {
  test(`live verdict: ${c.id}`, { timeout: 170000 }, async (t) => {
    const cfg = await liveConfig(t, { model: true });
    if (!cfg) return;
    const auth = await fetch(`${cfg.apiRoot}/run/auth/apps/${cfg.appId}/anonymous-session`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(auth.status, 200);
    const { token } = await auth.json();
    const conversationId = `verdict-${c.id}-${crypto.randomUUID()}`;
    const response = await fetch(`${cfg.apiRoot}/run/api/chat`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'x-inkeep-app-id': cfg.appId, Authorization: `Bearer ${token}` }, body: JSON.stringify({ conversationId, messages: [{ id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: c.question }] }] }), signal: AbortSignal.timeout(160000) });
    assert.equal(response.status, 200);
    const stream = await response.text();
    fs.writeFileSync(`logs/verdict-${c.id}.sse`, stream);
    const events = stream.split('\n').filter(l => l.startsWith('data: ') && l.slice(6) !== '[DONE]').map(l => JSON.parse(l.slice(6)));
    assert.equal(events.filter(isStreamError).length, 0);
    const answer = events.filter(e => e.type === 'text-delta').map(e => e.delta).join('');
    fs.writeFileSync(`logs/verdict-${c.id}.md`, answer);
    assert.match(answer, c.verdict);
    assert.match(answer, c.scope);
    if (c.id === 'copytrading') assert.doesNotMatch(answer, /\bpartial(?:ly)?\s+(?:fit|yes)\b/i);
    console.log(JSON.stringify({ scenario: c.id, conversationId, answer }));
  });
}
