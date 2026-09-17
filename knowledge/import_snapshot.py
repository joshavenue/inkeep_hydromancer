"""Import operator-supplied public captures into the existing snapshot ledgers.

Local files only: no HTTP, model calls, recursive discovery, or uploads.
See README.md for capture/review requirements and the catalog format.
"""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlparse

from contracts import DOCUMENT_ID_PATTERN, read_document

ROOT = Path(__file__).resolve().parent
SECTIONS = ('rest-a', 'rest-b', 'websocket', 'platform', 'native')


def import_snapshot(catalog, captures, destination):
    catalog = json.loads(Path(catalog).read_text(encoding='utf-8'))
    sources = catalog['sources']
    if catalog.get('format_version') != 1 or not isinstance(sources, list) or not 1 <= len(sources) <= 224:
        raise ValueError('Expected catalog format 1 with 1 to 224 reviewed public sources')
    captures, destination = Path(captures).resolve(), Path(destination).resolve()
    prepared = []
    ids, urls = set(), set()
    for source in sources:
        native = source['provider'] == 'native'
        prefix = 'native' if native else 'hydro'
        host = 'hyperliquid.gitbook.io' if native else 'docs.hydromancer.xyz'
        if (source['provider'] not in ('native', 'hydromancer') or
                source['section'] not in (('native',) if native else SECTIONS[:-1]) or
                not isinstance(source['id'], str) or
                not re.fullmatch(DOCUMENT_ID_PATTERN, source['id']) or
                not source['id'].startswith(prefix + '-')):
            raise ValueError('Invalid provider, section or document ID')
        parsed = urlparse(source['url'])
        if parsed.scheme != 'https' or parsed.netloc != host:
            raise ValueError('Non-public source URL in catalog')
        if source['id'] in ids or source['url'] in urls:
            raise ValueError('Duplicate document ID or URL in catalog')
        ids.add(source['id'])
        urls.add(source['url'])
        if not source['title'].strip() or not source['snapshot_date_basis'].strip():
            raise ValueError('Title and capture date basis are required')
        datetime.fromisoformat(source['snapshot_date'])
        filename = source['id'] + ('.txt' if native else '.md')
        path = (captures / filename).resolve()
        if not path.is_relative_to(captures):
            raise ValueError('Capture outside supplied directory')
        data = read_document(path)
        if hashlib.sha256(data).hexdigest() != source['sha256']:
            raise ValueError(f'Source hash mismatch: {source["id"]}')
        data.decode('utf-8')
        relative = ('pages/' if native else 'sources/') + filename
        record = {key: source[key] for key in ('url', 'title', 'snapshot_date', 'snapshot_date_basis')}
        record.update(id=source['id'].split('-')[1], status=200, retrieved_at=source['snapshot_date'])
        if native:
            record.update(file=relative, sha256_text=source['sha256'])
        else:
            record.update(path=relative, sha256=source['sha256'], markdown_valid=True)
        prepared.append((source['section'], relative, data, record))
    destination.mkdir(parents=True, exist_ok=False)
    for section in SECTIONS:
        root = destination / ('native' if section == 'native' else 'hydromancer')
        (root / ('pages' if section == 'native' else 'sources')).mkdir(parents=True, exist_ok=True)
        records = []
        for candidate, relative, data, record in prepared:
            if candidate == section:
                (root / relative).write_bytes(data)
                records.append(record)
        ledger = root / ('source_records.json' if section == 'native' else f'{section}-assignment.json')
        ledger.write_text(json.dumps(records, indent=2) + '\n', encoding='utf-8')
    return len(prepared)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, default=ROOT / 'public-source-catalog.json')
    parser.add_argument('--captures', type=Path, required=True, help='Directory of reviewed <id>.md / <id>.txt captures')
    parser.add_argument('--output', type=Path, default=ROOT / 'snapshots', help='New directory; existing directories are never overwritten')
    args = parser.parse_args()
    print(json.dumps({'imported': import_snapshot(args.catalog, args.captures, args.output)}))
