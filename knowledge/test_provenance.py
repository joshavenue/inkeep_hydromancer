"""Snapshot provenance tests use labeled fixtures, never inferred capture dates."""
import hashlib
import json
from pathlib import Path

import pytest

import knowledge as k


@pytest.mark.parametrize('native', [False, True])
def test_direct_ledger_uses_actual_retrieval_timestamp(tmp_path, synthetic_corpus, native):
    root = k.NATIVE if native else k.HYDRO
    ledger = root / ('source_records.json' if native else 'rest-a-assignment.json')
    rows = json.loads(ledger.read_text())
    record = rows[0]
    del record['snapshot_date']
    # A leftover basis describing another date must not be attached to retrieved_at.
    record['snapshot_date_basis'] = 'stale basis for a different snapshot'
    record['retrieved_at'] = '2026-10-01T12:34:56+00:00'
    ledger.write_text(json.dumps(rows))
    db = tmp_path / 'current.sqlite'
    report = k.build_index(db)
    identifier = ('native-' if native else 'hydro-') + str(record['id'])
    outputs = [next(d for d in report['sources'] if d['id'] == identifier),
               k.fetch(identifier, db=db),
               next(d for d in k.search(record['title'], 8, db=db)['results'] if d['id'] == identifier)]
    for output in outputs:
        assert output['snapshot_date'] == record['retrieved_at']
        assert output['snapshot_date_basis'] == 'retrieved_at'


@pytest.mark.parametrize('match', ['exact', 'url_only', 'hash_only', 'neither'])
def test_undated_ledger_requires_matching_historical_url_and_bytes(
        tmp_path, synthetic_corpus, monkeypatch, match):
    ledger = k.HYDRO / 'rest-a-assignment.json'
    rows = json.loads(ledger.read_text())
    record = rows[0]
    for key in ('snapshot_date', 'snapshot_date_basis', 'retrieved_at'):
        record.pop(key)
    # Isolate historical matching with synthetic bytes/catalog; the opt-in full
    # corpus suite independently checks compatibility with the unchanged catalog.
    historical = dict(url=record['url'], sha256=record['sha256'],
                      snapshot_date='2026-09-14', snapshot_date_basis='historical synthetic corpus date')
    catalog_root = tmp_path / 'catalog-root'
    catalog_root.mkdir()
    (catalog_root / 'public-source-catalog.json').write_text(json.dumps({'sources': [historical]}))
    monkeypatch.setattr(k, 'ROOT', catalog_root)
    if match in ('hash_only', 'neither'):
        record['url'] = 'https://docs.hydromancer.xyz/synthetic-new-url'
    if match in ('url_only', 'neither'):
        data = b'SYNTHETIC changed capture, not documentation.\n'
        Path(record['path']).write_bytes(data)
        record['sha256'] = hashlib.sha256(data).hexdigest()
    ledger.write_text(json.dumps(rows))
    db = tmp_path / 'existing.sqlite'
    db.write_bytes(b'Preserve existing index without provenance')
    if match == 'exact':
        k.build_index(db)
        output = k.fetch('hydro-' + str(record['id']), db=db)
        assert output['snapshot_date'] == historical['snapshot_date']
        assert output['snapshot_date_basis'] == historical['snapshot_date_basis']
    else:
        with pytest.raises(ValueError, match='provenance'):
            k.build_index(db)
        assert db.read_bytes() == b'Preserve existing index without provenance'


@pytest.mark.parametrize('change', [
    {'snapshot_date_basis': ''}, {'snapshot_date': 'not-a-date'},
    {'snapshot_date': None}, {'snapshot_date_basis': None},
])
def test_invalid_explicit_provenance_is_not_silently_replaced(
        tmp_path, synthetic_corpus, change):
    ledger = k.HYDRO / 'rest-a-assignment.json'
    rows = json.loads(ledger.read_text())
    rows[0].update(change)
    ledger.write_text(json.dumps(rows))
    db = tmp_path / 'existing.sqlite'
    db.write_bytes(b'Preserve existing index')
    with pytest.raises(ValueError, match='provenance'):
        k.build_index(db)
    assert db.read_bytes() == b'Preserve existing index'
