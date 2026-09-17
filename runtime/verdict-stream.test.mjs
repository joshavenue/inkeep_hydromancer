import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

function runSyntheticVerdicts(t, errorEvent) {
  const root = mkdtempSync(join(tmpdir(), 'inkeep-verdict-offline-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of ['verdict-live.test.mjs', 'live-config.mjs', 'config.mjs', 'sse-errors.mjs']) {
    copyFileSync(new URL(file, import.meta.url), join(root, file));
  }
  writeFileSync(join(root, 'preview-client.json'), JSON.stringify({ apiRoot: 'http://127.0.0.1:18502', appId: 'app_offlinefixture' }), { mode: 0o600 });
  const callsFile = join(root, 'calls.json');
  writeFileSync(callsFile, '[]');
  const mockFile = join(root, 'mock-fetch.mjs');
  // The real opt-in gates run, but every fetch is intercepted before any I/O.
  // No inherited credentials, real configuration or live service is used.
  writeFileSync(mockFile, `
    import fs from 'node:fs';
    const calls = [];
    const errorEvent = ${JSON.stringify(errorEvent)};
    globalThis.fetch = async (url, options = {}) => {
      calls.push(url);
      fs.writeFileSync(${JSON.stringify(callsFile)}, JSON.stringify(calls));
      if (url === 'http://127.0.0.1:18502/health') return new Response(null, { status: 204 });
      if (url === 'http://127.0.0.1:18581/health' || url === 'https://synthetic-model.invalid/v1/models') return Response.json({ synthetic: true });
      if (url === 'http://127.0.0.1:18502/run/auth/apps/app_offlinefixture/anonymous-session') return Response.json({ token: 'synthetic-session-token' });
      if (url === 'http://127.0.0.1:18502/run/api/chat') {
        const question = JSON.parse(options.body).messages[0].parts[0].text;
        const answer = question.includes('NFT')
          ? 'No. NFT minting and NFT contract deployment are outside the API scope.'
          : 'Yes. Hydromancer data and userFills support copytrading; execution is separate.';
        const events = [
          { type: 'data-operation', data: { type: 'finish' } },
          { type: 'text-delta', delta: answer },
          ...(errorEvent ? [errorEvent] : []),
        ];
        const stream = events.map(event => 'data: ' + JSON.stringify(event) + '\\n\\n').join('') + 'data: [DONE]\\n\\n';
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
      }
      throw new Error('Unexpected synthetic fixture request: ' + url);
    };
  `);
  const run = spawnSync(process.execPath, [
    '--import', pathToFileURL(mockFile).href, '--test', '--test-reporter=tap', '--test-name-pattern=^live verdict:', 'verdict-live.test.mjs',
  ], {
    cwd: root, env: {
      INKEEP_LIVE_TESTS: '1', INKEEP_MODEL_TESTS: '1', MODEL_BASE_URL: 'https://synthetic-model.invalid/v1', CUSTOM_LLM_API_KEY: 'synthetic-offline-key',
    }, encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(run.error);
  const calls = JSON.parse(readFileSync(callsFile, 'utf8'));
  assert.equal(calls.filter(url => url.endsWith('/run/api/chat')).length, 2, run.stdout + run.stderr);
  for (const id of ['copytrading', 'nft-launch']) {
    const stream = readFileSync(join(root, `logs/verdict-${id}.sse`), 'utf8');
    assert.match(stream, /data: \[DONE\]/);
    assert.match(stream, id === 'copytrading' ? /Yes.*userFills/ : /No.*NFT/);
  }
  return run;
}

for (const [kind, errorEvent] of [
  ['top-level', { type: 'error', errorText: 'synthetic stream failure' }],
  ['data-operation', { type: 'data-operation', data: { type: 'error', message: 'synthetic operation failure' } }],
]) {
  test(`synthetic SSE: ${kind} errors fail both live verdict checks despite valid Yes/No text`, (t) => {
    const run = runSyntheticVerdicts(t, errorEvent);
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stdout, /not ok \d+ - live verdict: copytrading/);
    assert.match(run.stdout, /not ok \d+ - live verdict: nft-launch/);
    assert.match(run.stdout, /ERR_ASSERTION/);
    assert.match(run.stdout, /# fail 2\b/);
    assert.match(run.stdout, /# skipped 0\b/);
  });
}

test('synthetic SSE: valid Yes/No text and non-error operation events pass both verdict checks', (t) => {
  const run = runSyntheticVerdicts(t, null);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /# pass 2\b/);
  assert.match(run.stdout, /# fail 0\b/);
  assert.match(run.stdout, /# skipped 0\b/);
});
