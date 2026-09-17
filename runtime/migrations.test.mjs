import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('migration preparation preserves upstream schema, legacy backfill and journal byte-for-byte', async () => {
  assert.ok(existsSync(new URL('./scripts/prepare-migrations.mjs', import.meta.url)), 'safe migration preparation is required');
  const { copyMigrations } = await import('./scripts/prepare-migrations.mjs');
  const root = mkdtempSync(join(tmpdir(), 'inkeep-migrations-'));
  const packageRoot = join(root, 'package');
  const destination = join(root, 'build');
  try {
    mkdirSync(join(packageRoot, 'drizzle/manage/meta'), { recursive: true });
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: '@inkeep/agents-core', version: '0.80.6' }));
    const fixture = {
      '0014_complex_firebird.sql': 'CREATE TABLE "skill_files" ("id" text);\n',
      '0015_backfill_skill_files.sql': 'INSERT INTO "skill_files" SELECT "id" FROM "skills";\n',
      'meta/_journal.json': JSON.stringify({ entries: [{ tag: '0014_complex_firebird' }, { tag: '0015_backfill_skill_files' }] }),
      'meta/0015_snapshot.json': '{"fixture":true}\n',
    };
    for (const [file, value] of Object.entries(fixture)) writeFileSync(join(packageRoot, 'drizzle/manage', file), value);
    copyMigrations({ packageRoot, destination });
    for (const [file, value] of Object.entries(fixture)) assert.equal(readFileSync(join(destination, file), 'utf8'), value);
    assert.throws(() => copyMigrations({ packageRoot, destination }), /exist|overwrite/i);
    assert.equal(readFileSync(join(packageRoot, 'drizzle/manage/0015_backfill_skill_files.sql'), 'utf8'), fixture['0015_backfill_skill_files.sql']);
    writeFileSync(join(packageRoot, 'drizzle/manage/0015_backfill_skill_files.sql'), 'SELECT 1;');
    assert.throws(() => copyMigrations({ packageRoot, destination: join(root, 'tampered') }), /0015/);
    assert.equal(existsSync(join(root, 'tampered')), false);
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: '@inkeep/agents-core', version: '9.9.9' }));
    assert.throws(() => copyMigrations({ packageRoot, destination: join(root, 'other') }), /0\.80\.6/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
