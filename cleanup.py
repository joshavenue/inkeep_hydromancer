import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import time

root = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--dry-run', action='store_true')
parser.add_argument('--at-expiry', action='store_true')
args = parser.parse_args()
record = json.loads((root / 'lifecycle.json').read_text())
# Validate the entire operator manifest before waiting, signalling or stopping anything.
if not isinstance(record, dict):
    raise ValueError('Cleanup manifest must be an object.')
if type(record.get('expiresAt')) is not int or record['expiresAt'] <= 0:
    raise ValueError('Cleanup expiresAt must be a positive integer timestamp in milliseconds.')
if not isinstance(record.get('processes'), list):
    raise ValueError('Cleanup processes must be a list.')
seen_pids = set()
for item in record['processes']:
    if (not isinstance(item, dict)
            or type(item.get('pid')) is not int or item['pid'] <= 0
            or item['pid'] in seen_pids
            or not isinstance(item.get('role'), str) or not item['role'].strip()
            or not isinstance(item.get('start_ticks'), str)
            or not item['start_ticks'].isascii() or not item['start_ticks'].isdecimal()):
        raise ValueError('Each cleanup process needs a unique positive integer pid, role and decimal start_ticks string.')
    seen_pids.add(item['pid'])
expected = {'hydro-inkeep-preview-doltgres', 'hydro-inkeep-preview-postgres', 'hydro-inkeep-preview-spicedb'}
containers = record.get('containers')
if (not isinstance(containers, list) or len(containers) != len(expected)
        or any(not isinstance(name, str) for name in containers)
        or set(containers) != expected):
    raise ValueError('Cleanup requires exactly the three allowed preview containers.')
if args.at_expiry:
    print(json.dumps({'cleanup_scheduled_at_ms': record['expiresAt']}), flush=True)
    time.sleep(max(0, record['expiresAt'] / 1000 - time.time()))
results = []
for item in record['processes']:
    pid = int(item['pid'])
    proc = Path(f'/proc/{pid}')
    try:
        start = proc.joinpath('stat').read_text().rsplit(')', 1)[1].split()[22 - 3]
        owned = proc.stat().st_uid == os.getuid() and start == item['start_ticks']
    except (FileNotFoundError, ProcessLookupError):
        owned = False
    action = 'would_stop' if args.dry_run and owned else 'skipped'
    if owned and not args.dry_run:
        try:
            os.kill(pid, signal.SIGTERM)
            action = 'stopped'
        except ProcessLookupError:
            action = 'exited'
    results.append({'role': item['role'], 'pid': pid, 'matched_original_process': owned, 'action': action})
if not args.dry_run:
    result = subprocess.run(['podman', 'stop', *record['containers']], capture_output=True, text=True, timeout=90)
    results.append({'container_stop_exit': result.returncode, 'output': result.stdout})
print(json.dumps(results, indent=2), flush=True)
