"""Refresh the local index from the three public sources in one command.

    .venv/bin/python refresh.py            # capture -> import -> build data/public-docs.sqlite
    .venv/bin/python refresh.py --limit 3  # smoke run, 3 pages per source

Each run writes a new timestamped snapshot directory under data/ and then
atomically replaces data/public-docs.sqlite. Point the MCP server at that file:

    HYDROMANCER_KNOWLEDGE_DB="$PWD/data/public-docs.sqlite" .venv/bin/python server.py

Restart the server after a refresh; it opens the SQLite file immutably.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import sys

import knowledge
from capture_public_sources import capture
from import_snapshot import import_snapshot

ROOT = Path(__file__).resolve().parent


def refresh(data=ROOT / 'data', *, limit=None, delay=0.25, providers=('hydromancer', 'site', 'native'), fetch_impl=None):
    data = Path(data)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    work = data / f'capture-{stamp}'
    kwargs = {'fetch_impl': fetch_impl} if fetch_impl else {}
    report = capture(work, providers=providers, delay=delay, limit=limit,
                     log=lambda line: print(line, file=sys.stderr), **kwargs)
    if report['captured'] == 0:
        raise RuntimeError('Nothing captured; the existing index is unchanged')
    snapshot = data / f'snapshot-{stamp}'
    imported = import_snapshot(work / 'catalog.json', work / 'captures', snapshot)
    db = data / 'public-docs.sqlite'
    previous = (knowledge.HYDRO, knowledge.NATIVE, knowledge.SITE)
    knowledge.HYDRO, knowledge.NATIVE, knowledge.SITE = (snapshot / 'hydromancer', snapshot / 'native', snapshot / 'site')
    try:
        built = knowledge.build_index(db)
    finally:
        knowledge.HYDRO, knowledge.NATIVE, knowledge.SITE = previous
    (data / 'manifest.json').write_text(json.dumps(built, indent=2) + '\n')
    shutil.rmtree(work / 'captures')  # bodies now live in the snapshot; keep catalog + skipped list
    summary = {'captured': report['captured'], 'skipped': report['skipped'], 'per_provider': report['per_provider'],
               'imported': imported, 'indexed': built['source_count'], 'passages': built['passage_count'],
               'provider_counts': built['provider_counts'], 'snapshot': str(snapshot), 'index': str(db)}
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--data', type=Path, default=ROOT / 'data')
    parser.add_argument('--limit', type=int, default=None)
    parser.add_argument('--delay', type=float, default=0.25)
    parser.add_argument('--providers', nargs='+', default=['hydromancer', 'site', 'native'])
    args = parser.parse_args()
    print(json.dumps(refresh(args.data, limit=args.limit, delay=args.delay, providers=tuple(args.providers)), indent=2))
