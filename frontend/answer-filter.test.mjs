import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnswerFilter } from './answer-filter.mjs';

const line = obj => `data: ${JSON.stringify(obj)}\n\n`;
const text = (id, delta) => line({ type: 'text-delta', id, delta });

async function run(sseText, chunkSize = 7) {
  const encoder = new TextEncoder();
  const source = new ReadableStream({
    start(controller) {
      for (let i = 0; i < sseText.length; i += chunkSize) controller.enqueue(encoder.encode(sseText.slice(i, i + chunkSize)));
      controller.close();
    },
  });
  const chunks = [];
  for await (const chunk of source.pipeThrough(createAnswerFilter())) chunks.push(chunk);
  return new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))));
}

const events = sse => sse.split('\n').filter(l => l.startsWith('data:') && !l.includes('[DONE]')).map(l => JSON.parse(l.slice(5)));

test('narration before a tool call is dropped; the answer after it is kept verbatim', async () => {
  const input = line({ type: 'start', messageId: 'm' })
    + line({ type: 'text-start', id: 'a' }) + text('a', "I'll check the docs on this.") + line({ type: 'text-end', id: 'a' })
    + line({ type: 'tool-input-start', toolCallId: 't1', toolName: 'search_hydromancer_docs' })
    + line({ type: 'tool-input-available', toolCallId: 't1', toolName: 'search_hydromancer_docs', input: { query: 'x' } })
    + line({ type: 'tool-output-available', toolCallId: 't1', output: {} })
    + line({ type: 'text-start', id: 'b' }) + text('b', 'Yes, Hydromancer ') + text('b', 'covers the data side. ' + 'x'.repeat(300)) + line({ type: 'text-end', id: 'b' })
    + line({ type: 'finish' }) + 'data: [DONE]\n\n';
  const out = events(await run(input));
  assert.ok(!JSON.stringify(out).includes("I'll check"));
  assert.deepEqual(out.map(e => e.type), ['start', 'tool-input-start', 'tool-input-available', 'tool-output-available', 'text-start', 'text-delta', 'text-delta', 'text-end', 'finish']);
  assert.ok(out.find(e => e.type === 'text-delta').delta.startsWith('Yes, Hydromancer'));
});

// Inkeep 0.80.6 emits one text-start/text-end pair around every delta.
const wrapped = (id, delta) => line({ type: 'text-start', id }) + text(id, delta) + line({ type: 'text-end', id });

test('per-delta text-start/text-end wrapping: narration dropped, full answer kept', async () => {
  const words = 'Reservoir is a free archive of Hyperliquid historical data delivered as daily Parquet files. '.split(' ');
  let answer = '';
  for (let i = 0; i < 12; i++) for (const w of words) answer += wrapped('b', w + ' ');
  const input = line({ type: 'start', messageId: 'm' })
    + wrapped('a', "I'll") + wrapped('a', ' look') + wrapped('a', ' this up.')
    + line({ type: 'tool-input-start', toolCallId: 't1', toolName: 'search_hydromancer_docs' })
    + line({ type: 'tool-input-available', toolCallId: 't1', toolName: 'search_hydromancer_docs', input: { query: 'x' } })
    + line({ type: 'tool-output-available', toolCallId: 't1', output: {} })
    + answer + line({ type: 'data-operation', data: { type: 'completion' } }) + 'data: [DONE]\n\n';
  const out = await run(input, 11);
  const deltas = events(out).filter(e => e.type === 'text-delta').map(e => e.delta).join('');
  assert.ok(!deltas.includes("I'll"));
  assert.equal(deltas, words.join(' ').concat(' ').repeat(12), 'every answer delta survives in order');
  assert.equal(events(out).filter(e => e.type === 'text-start').length, 12 * words.length);
});

test('per-delta wrapping with a short final answer and no tool call is kept whole', async () => {
  const input = wrapped('a', 'No.') + wrapped('a', ' Hydromancer is read-only.') + line({ type: 'data-operation', data: { type: 'completion' } });
  assert.equal(await run(input, 5), input);
});

test('a short answer with no tool call is released untouched at stream end', async () => {
  const input = line({ type: 'text-start', id: 'a' }) + text('a', "I can't help with weather.") + line({ type: 'text-end', id: 'a' }) + line({ type: 'finish' });
  const out = await run(input);
  assert.equal(out, input);
});

test('a short text followed by a non-tool event is kept', async () => {
  const input = line({ type: 'text-start', id: 'a' }) + text('a', 'No.') + line({ type: 'text-end', id: 'a' })
    + line({ type: 'data-operation', data: { type: 'completion' } }) + line({ type: 'finish' });
  assert.equal(await run(input), input);
});

test('long text streams through as soon as it passes the hold threshold', async () => {
  const long = 'y'.repeat(260);
  const input = line({ type: 'text-start', id: 'a' }) + text('a', long) + text('a', 'more') + line({ type: 'text-end', id: 'a' }) + line({ type: 'finish' });
  assert.equal(await run(input, 5), input);
});

test('non-SSE bytes and malformed data lines pass through unchanged', async () => {
  const input = ': keep-alive\n\ndata: not json\n\n' + line({ type: 'finish' });
  assert.equal(await run(input), input);
});
