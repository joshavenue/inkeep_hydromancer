import { cpSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const runtime = fileURLToPath(new URL('../', import.meta.url));
export function copyMigrations({
  packageRoot = join(runtime, 'node_modules/@inkeep/agents-core'),
  destination = join(runtime, '.build/manage-migrations'),
} = {}) {
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  if (pkg.name !== '@inkeep/agents-core' || pkg.version !== '0.80.6') {
    throw new Error('Migration source must be released @inkeep/agents-core 0.80.6.');
  }
  if (existsSync(destination)) throw new Error('Refusing to overwrite existing migration build directory.');
  const source = join(packageRoot, 'drizzle/manage');
  const journal = JSON.parse(readFileSync(join(source, 'meta/_journal.json'), 'utf8'));
  if (!journal.entries?.some(entry => entry.tag === '0015_backfill_skill_files')) {
    throw new Error('Upstream migration journal must include the legacy 0015 backfill.');
  }
  for (const entry of journal.entries) readFileSync(join(source, `${entry.tag}.sql`));
  const legacy = readFileSync(join(source, '0015_backfill_skill_files.sql'), 'utf8');
  if (!/INSERT INTO \"skill_files\"/.test(legacy) || !/FROM \"skills\"/.test(legacy)) {
    throw new Error('Refusing source with missing/replaced 0015 skill-file data backfill. Reinstall locked upstream dependencies.');
  }
  mkdirSync(dirname(destination), { recursive: true });
  // No SQL rewriting, filtering, skipping, schema generation or database access.
  cpSync(source, destination, { recursive: true, force: false, errorOnExist: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    copyMigrations();
    console.log('Copied unmodified Inkeep 0.80.6 manage migrations to .build/manage-migrations. No DB accessed.');
  } catch (error) {
    console.error(error.code === 'ENOENT' ? 'Install locked runtime dependencies before preparing migrations.' : error.message);
    process.exitCode = 1;
  }
}
