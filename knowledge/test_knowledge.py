"""Offline mechanics/security checks against labeled synthetic fixtures only."""
import hashlib
import importlib
import importlib.util
import json
from pathlib import Path
import sqlite3
from urllib.parse import urlparse

import pytest

pytestmark = pytest.mark.usefixtures('synthetic_corpus')

ROOT = Path(__file__).resolve().parent



def module():
    assert importlib.util.find_spec('knowledge') is not None, 'Public index builder must exist'
    return importlib.import_module('knowledge')


def approved_records():
    k = module()
    records = []
    for section in ('rest-a', 'rest-b', 'websocket', 'platform'):
        for r in json.loads((k.HYDRO / f'{section}-assignment.json').read_text()):
            records.append((r['url'], r['sha256'], r['path'], section))
    for r in json.loads((k.NATIVE / 'source_records.json').read_text()):
        if r['url'].startswith('https://hyperliquid.gitbook.io/'):
            records.append((r['url'], r['sha256_text'], r['file'], 'native'))
    return records


def test_synthetic_corpus_build_and_integrity(tmp_path):
    k = module()
    db = tmp_path / 'test.sqlite'
    report = k.build_index(db)
    expected = {url: (sha, path, section) for url, sha, path, section in approved_records()}
    with sqlite3.connect(db) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute('SELECT * FROM documents').fetchall()
        assert len(rows) == len(expected) == report['source_count']
        assert conn.execute("SELECT count(*) FROM passages_fts WHERE passages_fts MATCH 'userFills'").fetchone()[0] > 0
        for r in rows:
            sha, path, section = expected[r['url']]
            assert r['sha256'] == sha == hashlib.sha256(Path(path).read_bytes()).hexdigest()
            assert r['body'] == Path(path).read_text()
            assert r['snapshot_date'][:10] == '2026-01-01'
            assert r['body'].startswith('SYNTHETIC TEST FIXTURE')
            assert r['section'] == section and r['title']
            assert urlparse(r['url']).hostname in ('docs.hydromancer.xyz', 'hyperliquid.gitbook.io')
    assert report['hashes_verified'] == len(expected)
    assert report['source_count'] == 10
    assert report['provider_counts'] == {'hydromancer': 7, 'native': 3}


def test_search_exact_endpoints_and_natural_fit(tmp_path):
    k = module()
    assert hasattr(k, 'search'), 'Deterministic public search must exist'
    db = tmp_path / 'search.sqlite'
    k.build_index(db)
    for endpoint in ('userFillsByTime', 'batchClearinghouseStates', 'l2BookDiffSnapshot'):
        hits = k.search(endpoint, 4, db=db)['results']
        assert hits and hits[0]['title'] == endpoint
    hits = k.search('Is Hydromancer a good fit for my copytrading bot?', 8, db=db)['results']
    titles = {h['title'] for h in hits}
    assert {'Copytrading and social trading', 'userFills', 'userFillsByTime',
            'batchClearinghouseStates', 'Session Management and Reconnection',
            'Rate limits and user limits | Hyperliquid Docs'} <= titles
    for query, title in [('native API limits for a small bot', 'Rate limits and user limits | Hyperliquid Docs'),
                         ('recover missed events after websocket disconnect', 'Session Management and Reconnection')]:
        assert k.search(query, 4, db=db)['results'][0]['title'] == title
    assert k.search('zzzzzzunknownterm9876', 8, db=db)['results'] == []
    with sqlite3.connect(db) as conn:
        source = {r[0]: r[1] for r in conn.execute('SELECT id,body FROM documents')}
    for h in hits:
        assert h['excerpt'] in source[h['id']]
        assert h['context_excerpt'] in source[h['id']]
        assert h['title'] and h['heading'] and h['url'] and h['sha256'] and h['snapshot_date'] and h['section']
        assert len(h['excerpt']) <= 4200 and len(h['context_excerpt']) <= 1000
        assert 'source_path' not in h and 'body' not in h


def test_native_endpoint_passages_keep_associated_headings(tmp_path):
    k = module()
    db = tmp_path / 'native.sqlite'
    k.build_index(db)
    with k.connect(db) as conn:
        passages = conn.execute("SELECT heading,body FROM passages WHERE doc_id='native-1' AND body LIKE '%userFillsByTime%'").fetchall()
    assert passages
    assert all('time' in r['heading'].lower() and 'fill' in r['heading'].lower() for r in passages)
    assert any('2000' in r['body'] and '10000' in r['body'] for r in passages)


def test_endpoint_and_fit_snippets_include_limits_not_only_code(tmp_path):
    k = module()
    db = tmp_path / 'context.sqlite'
    k.build_index(db)
    batch = k.search('batchClearinghouseStates', 1, db=db)['results'][0]
    assert '1000 users' in batch['excerpt'] and '100 users' in batch['excerpt']
    bytime = k.search('userFillsByTime', 1, db=db)['results'][0]
    assert bytime['start_offset'] == 0
    copy = k.search('copytrading', 8, db=db)['results']
    recovery = next(r for r in copy if r['id'] == 'hydro-132')
    assert '30 seconds' in recovery['excerpt'] and 'sent' in recovery['excerpt']


def test_closed_allowlist_rejects_tampering_and_deduplicates(tmp_path, monkeypatch):
    import pytest
    k = module()
    original = json.loads((k.HYDRO / 'rest-a-assignment.json').read_text())[0]
    hydro = tmp_path / 'tamper-hydro'
    native = tmp_path / 'tamper-native'
    (hydro / 'sources').mkdir(parents=True)
    native.mkdir()
    capture = hydro / 'sources/page.md'
    capture.write_bytes(Path(original['path']).read_bytes())
    record = dict(original, path=str(capture))
    for section in ('rest-b', 'websocket', 'platform'):
        (hydro / f'{section}-assignment.json').write_text('[]')
    (native / 'source_records.json').write_text('[]')
    ledger = hydro / 'rest-a-assignment.json'
    ledger.write_text(json.dumps([record, record]))
    monkeypatch.setattr(k, 'HYDRO', hydro)
    monkeypatch.setattr(k, 'NATIVE', native)
    assert len(list(k.approved_sources())) == 1
    for changes in ({'url':'https://notion.so/private'}, {'path':'/etc/passwd'},
                    {'sha256':'0'*64}, {'url':'https://docs.hydromancer.xyz.evil.example/page.md'},
                    {'markdown_valid':False}):
        ledger.write_text(json.dumps([dict(record, **changes)]))
        with pytest.raises(ValueError):
            list(k.approved_sources())
    ledger.write_text(json.dumps([record]))
    capture.write_text(capture.read_text() + '\nUntrusted alteration in isolated test fixture')
    with pytest.raises(ValueError, match='hash mismatch'):
        k.build_index(tmp_path / 'must-not-exist.sqlite')
    assert not (tmp_path / 'must-not-exist.sqlite').exists()


def test_bounded_queries_and_readonly_fetch(tmp_path):
    import pytest
    k = module()
    db = tmp_path / 'bounded.sqlite'
    k.build_index(db)
    for query, limit in [('a' * 501, 1), ('', 1), ('  ', 1), ('userFills', 0), ('userFills', 9)]:
        with pytest.raises(ValueError):
            k.search(query, limit, db=db)
    assert len(k.search('userFills', 1, db=db)['results']) == 1
    # SQL/FTS operators are literal words, so matching public text is acceptable.
    assert len(k.search('" OR * NOT ) ; DROP TABLE documents; --', 2, db=db)['results']) <= 2
    with k.connect(db) as conn:
        assert conn.execute('SELECT count(*) FROM documents').fetchone()[0] == 10
    assert hasattr(k, 'fetch'), 'Bounded ID-only fetch must exist'
    result = k.fetch('hydro-132', db=db)
    assert len(result['text']) <= 10000 and result['next_offset'] > 0
    assert 'source_path' not in result
    next_page = k.fetch('hydro-132', offset=result['next_offset'], db=db)
    with k.connect(db) as conn:
        body = conn.execute("SELECT body FROM documents WHERE id='hydro-132'").fetchone()[0]
        assert result['text'] + next_page['text'] == body[:20000]
        with pytest.raises(sqlite3.OperationalError):
            conn.execute('DELETE FROM documents')
    for identifier in ('../../etc/passwd', 'https://example.com', 'native-9999', 'hydro-1 OR 1=1'):
        with pytest.raises(ValueError):
            k.fetch(identifier, db=db)
    with pytest.raises(ValueError):
        k.fetch('hydro-132', offset=-1, db=db)
