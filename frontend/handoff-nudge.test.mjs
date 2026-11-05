import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandoffNudge, needsHandoff, exchangeCount, HANDOFF_TEXT } from './handoff-nudge.mjs';

const line = obj => `data: ${JSON.stringify(obj)}\n\n`;
const events = sse => sse.split('\n').filter(l => l.startsWith('data:') && !l.includes('[DONE]')).map(l => JSON.parse(l.slice(5)));
async function run(input, chunk = 7) {
  const stream = new ReadableStream({
    start(c) { const b = new TextEncoder().encode(input); for (let i = 0; i < b.length; i += chunk) c.enqueue(b.slice(i, i + chunk)); c.close(); },
  }).pipeThrough(createHandoffNudge());
  let out = ''; for await (const part of stream) out += new TextDecoder().decode(part); return out;
}
const user = content => ({ role: 'user', content });
const bot = content => ({ role: 'assistant', content });

test('exchanges are counted by user messages only', () => {
  const messages = [user('a'), bot('b'), user('c')];
  assert.equal(exchangeCount(messages), 2);
  assert.equal(exchangeCount(null), 0);
});

test('handoff starts on the eleventh exchange', () => {
  const ten = Array.from({ length: 10 }, (_, i) => [user(`q${i}`), bot(`a${i}`)]).flat();
  assert.equal(needsHandoff(ten), false);
  assert.equal(needsHandoff([...ten, user('q10')]), true);
});

test('footer is inserted before the completion event and the answer is untouched', async () => {
  const input = line({ type: 'text-start', id: 'x' }) + line({ type: 'text-delta', id: 'x', delta: 'Use userFills.' }) + line({ type: 'text-end', id: 'x' })
    + line({ type: 'data-operation', data: { type: 'completion' } }) + 'data: [DONE]\n\n';
  const out = await run(input);
  const ev = events(out);
  const text = ev.filter(e => e.type === 'text-delta').map(e => e.delta).join('');
  assert.equal(text, 'Use userFills.' + HANDOFF_TEXT);
  assert.ok(text.includes('https://t.me/xenoflux'));
  const idx = t => ev.findIndex(e => e.type === t);
  assert.ok(ev.findLastIndex(e => e.type === 'text-end') < idx('data-operation'), 'footer precedes completion');
  assert.equal(out.trim().endsWith('data: [DONE]'), true);
});

test('footer appears once even when [DONE] follows completion, and is appended if neither appears', async () => {
  const withDone = await run(line({ type: 'data-operation', data: { type: 'completion' } }) + 'data: [DONE]\n\n');
  assert.equal(withDone.split('t.me/xenoflux').length - 1, 1);
  const bare = await run(line({ type: 'text-start', id: 'y' }) + line({ type: 'text-delta', id: 'y', delta: 'Hi' }));
  assert.equal(bare.split('t.me/xenoflux').length - 1, 1);
});
