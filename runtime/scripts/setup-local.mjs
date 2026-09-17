import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--directory')) {
  console.error('Usage: node scripts/setup-local.mjs [--directory DIR]');
  process.exit(1);
}
const directory = args[1] ? resolve(args[1]) : fileURLToPath(new URL('../', import.meta.url));
const template = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
const env = template.replace(/\{\{[A-Z_]+\}\}/g, () => `Aa1!${randomBytes(32).toString('hex')}`);
try {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(resolve(directory, '.env'), env, { flag: 'wx', mode: 0o600 });
  console.log('Created private .env; no services started. Configure MODEL_BASE_URL and credentials locally.');
} catch (error) {
  console.error(error.code === 'EEXIST' ? 'Refusing to overwrite existing .env.' : 'Could not create private .env.');
  process.exitCode = 1;
}
