import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const savedState = {
  accessToken: 'a'.repeat(64),
  expiresAt: 1_700_000_000_000, // Expired state must stay expired.
  usedRequests: 40,
  publishedOrigin: null,
};

function fixture(t, contents) {
  const dir = mkdtempSync(join(tmpdir(), 'preview-start-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  copyFileSync(new URL('./start.mjs', import.meta.url), join(dir, 'start.mjs'));
  // Exercise the real startup, but never bind a socket or wait for expiry.
  writeFileSync(join(dir, 'server.mjs'), `
    import { writeFileSync } from 'node:fs';
    export function createPreviewServer(config) {
      const { accessToken, expiresAt, usedRequests } = config;
      writeFileSync(new URL('./started.json', import.meta.url), JSON.stringify({ accessToken, expiresAt, usedRequests }));
      return { listen() {} };
    }
  `);
  const stateFile = join(dir, 'state.json');
  if (contents !== undefined) writeFileSync(stateFile, contents, { mode: 0o640 });
  return {
    stateFile,
    started: () => existsSync(join(dir, 'started.json')),
    startedConfig: () => JSON.parse(readFileSync(join(dir, 'started.json'), 'utf8')),
    run(bootstrap = '') {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        globalThis.setTimeout = () => {};
        ${bootstrap}
        await import('./start.mjs');
      `], { cwd: dir, encoding: 'utf8', timeout: 5000 });
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      return result;
    },
  };
}

for (const [name, contents, bootstrap] of [
  ['malformed JSON', '{"accessToken":', ''],
  ['unreadable state', JSON.stringify(savedState), `
    const fs = (await import('node:fs')).default;
    const { syncBuiltinESMExports } = await import('node:module');
    const readFileSync = fs.readFileSync;
    fs.readFileSync = (path, ...args) => {
      if (String(path).endsWith('/state.json')) throw Object.assign(new Error('fixture permission denied'), { code: 'EACCES' });
      return readFileSync(path, ...args);
    };
    syncBuiltinESMExports();
  `],
]) {
  test(`startup preserves ${name} and aborts before creating the server`, t => {
    const f = fixture(t, contents);
    const before = statSync(f.stateFile);
    const result = f.run(bootstrap);
    assert.notEqual(result.status, 0, 'invalid state must abort startup');
    assert.equal(f.started(), false);
    assert.equal(readFileSync(f.stateFile, 'utf8'), contents);
    const after = statSync(f.stateFile);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(after.mode, before.mode);
  });
}

for (const [name, state] of [
  ['null', null],
  ['array', []],
  ['empty object', {}],
  ['missing token', { ...savedState, accessToken: undefined }],
  ['short token', { ...savedState, accessToken: 'short' }],
  ['non-string token', { ...savedState, accessToken: 123 }],
  ['missing expiry', { ...savedState, expiresAt: undefined }],
  ['null expiry', { ...savedState, expiresAt: null }],
  ['string expiry', { ...savedState, expiresAt: '1700000000000' }],
  ['negative expiry', { ...savedState, expiresAt: -1 }],
  ['fractional expiry', { ...savedState, expiresAt: 1.5 }],
  ['out-of-range expiry', { ...savedState, expiresAt: 8_640_000_000_000_001 }],
  ['missing usage', { ...savedState, usedRequests: undefined }],
  ['null usage', { ...savedState, usedRequests: null }],
  ['string usage', { ...savedState, usedRequests: '40' }],
  ['negative usage', { ...savedState, usedRequests: -1 }],
  ['fractional usage', { ...savedState, usedRequests: 1.5 }],
  ['unsafe usage', { ...savedState, usedRequests: Number.MAX_SAFE_INTEGER + 1 }],
  ['missing origin', { ...savedState, publishedOrigin: undefined }],
  ['non-string origin', { ...savedState, publishedOrigin: [] }],
  ['invalid origin', { ...savedState, publishedOrigin: 'not an origin' }],
  ['non-HTTP origin', { ...savedState, publishedOrigin: 'file:///tmp' }],
  ['origin with a path', { ...savedState, publishedOrigin: 'https://preview.example.test/path' }],
]) {
  test(`startup rejects ${name} without changing the saved state`, t => {
    const contents = JSON.stringify(state);
    const f = fixture(t, contents);
    const before = statSync(f.stateFile);
    const result = f.run();
    assert.notEqual(result.status, 0, 'invalid state must abort startup');
    assert.equal(f.started(), false);
    assert.equal(readFileSync(f.stateFile, 'utf8'), contents);
    const after = statSync(f.stateFile);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(after.mode, before.mode);
  });
}

test('startup accepts an exact published HTTPS origin without resetting state', t => {
  const contents = JSON.stringify({ ...savedState, publishedOrigin: 'https://preview.example.test' });
  const f = fixture(t, contents);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.started(), true);
  assert.equal(readFileSync(f.stateFile, 'utf8'), contents);
});

test('startup creates private state only when absent', t => {
  const f = fixture(t);
  const before = Date.now();
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.started(), true);
  const state = JSON.parse(readFileSync(f.stateFile, 'utf8'));
  assert.match(state.accessToken, /^[a-f0-9]{64}$/);
  assert.ok(state.expiresAt >= before + 6 * 60 * 60 * 1000);
  assert.ok(state.expiresAt <= Date.now() + 6 * 60 * 60 * 1000);
  assert.equal(state.usedRequests, 0);
  assert.equal(state.publishedOrigin, null);
  assert.equal(statSync(f.stateFile).mode & 0o777, 0o600);
});

test('startup preserves existing expired state and exhausted usage', t => {
  const contents = JSON.stringify(savedState, null, 2);
  const f = fixture(t, contents);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.started(), true);
  assert.deepEqual(f.startedConfig(), {
    accessToken: savedState.accessToken, expiresAt: savedState.expiresAt, usedRequests: savedState.usedRequests,
  });
  assert.equal(readFileSync(f.stateFile, 'utf8'), contents);
});
