#!/usr/bin/env python3
"""Derive deploy/.env (compose variables) from the generated runtime/.env.

Reads the two database URLs and the SpiceDB preshared key that
runtime/scripts/setup-local.mjs generated, adds a fresh random password for
SpiceDB's own Postgres database, and writes deploy/.env with mode 0600.
Prints nothing but variable names. Refuses to overwrite an existing file.
"""
import os
import secrets
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

here = Path(__file__).resolve().parent
runtime_env = here.parent / 'runtime' / '.env'
out = here / '.env'
if out.exists():
    sys.exit(f'{out} exists; remove it deliberately before regenerating.')

values = {}
for line in runtime_env.read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        key, _, value = line.partition('=')
        values[key.strip()] = value.strip()

def password(url_key):
    url = urlsplit(values[url_key])
    if not url.password:
        sys.exit(f'{url_key} has no password')
    return unquote(url.password)

env = {
    'MANAGE_DB_PASSWORD': password('INKEEP_AGENTS_MANAGE_DATABASE_URL'),
    'RUN_DB_PASSWORD': password('INKEEP_AGENTS_RUN_DATABASE_URL'),
    'SPICEDB_PRESHARED_KEY': values['SPICEDB_PRESHARED_KEY'],
    'SPICEDB_DB_PASSWORD': secrets.token_hex(24),
}
for key, value in env.items():
    if not value or any(ch in value for ch in '\n"\'$'):
        sys.exit(f'{key} is empty or contains characters compose cannot pass safely')

fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as handle:
    handle.write(''.join(f'{k}={v}\n' for k, v in env.items()))
print('wrote', out, 'with', ', '.join(env))
