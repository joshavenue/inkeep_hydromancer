#!/usr/bin/env python3
"""Turn curated ecosystem app research (JSON) into indexable Markdown pages plus
the ledger knowledge.py expects. Each page cites the app's own public website.

    .venv/bin/python build_ecosystem.py apps.json        # writes ecosystem/sources/eco-N.md + apps-assignment.json

Input entries: {name, x, website, category, summary, hyperliquid_link, data_needs[],
status_note, sources[]}. Nothing about customers, plans or pricing belongs here.
"""
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'ecosystem'
# Anything that would reveal a business relationship with Hydromancer. Apps' own
# product wording ("enterprise API", "client orders", "pricing to be published") is fine.
FORBIDDEN = re.compile(r'hydromancer|hydromancer customer|our customer|data plan|starter plan|growth plan|scale plan|'
                       r'custom plan|peering|churn|prospect|trial key|vibes|connection strength|@zorro', re.I)


def page(entry):
    name = entry['name']
    url = entry.get('website') or (f"https://x.com/{entry['x']}" if entry.get('x') else '')
    lines = [f"# {name}", '',
             f"{name} is a Hyperliquid ecosystem app. Category: {entry.get('category', 'other')}.", '',
             '## What it is', '', entry['summary'].strip(), '']
    if entry.get('hyperliquid_link') and entry['hyperliquid_link'] != 'not stated publicly':
        lines += ['## How it relates to Hyperliquid', '', entry['hyperliquid_link'].strip(), '']
    if entry.get('data_needs'):
        lines += ['## Hyperliquid data an app like this needs', ''] + [f"- {d}" for d in entry['data_needs']] + ['']
    if entry.get('status_note') and entry['status_note'] != 'active':
        lines += ['## Status', '', entry['status_note'], '']
    lines += ['## Public sources', ''] + [f"- {s}" for s in entry.get('sources', [])] + ['']
    return url, '\n'.join(lines)


def build(apps):
    (OUT / 'sources').mkdir(parents=True, exist_ok=True)
    records = []
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    for n, entry in enumerate(sorted(apps, key=lambda a: a['name'].lower()), start=1):
        url, text = page(entry)
        if not url.startswith('https://'):
            print(f'skip {entry["name"]}: no public URL', file=sys.stderr)
            continue
        body = text
        if FORBIDDEN.search(body.split('## Public sources')[0]):
            raise ValueError(f'{entry["name"]}: page text mentions a forbidden business term')
        path = OUT / 'sources' / f'eco-{n}.md'
        path.write_text(body, encoding='utf-8')
        records.append({'id': n, 'title': f"{entry['name']} (Hyperliquid ecosystem app)", 'url': url, 'status': 200,
                        'path': f'sources/eco-{n}.md', 'sha256': hashlib.sha256(body.encode()).hexdigest(),
                        'markdown_valid': True, 'snapshot_date': now,
                        'snapshot_date_basis': 'curated summary written from the app\'s public website and X profile on this date'})
    (OUT / 'apps-assignment.json').write_text(json.dumps(records, indent=2) + '\n', encoding='utf-8')
    return len(records)


if __name__ == '__main__':
    apps = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    print(json.dumps({'pages': build(apps), 'output': str(OUT)}))
