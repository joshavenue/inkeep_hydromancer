"""Opt-in checks of the REAL historical corpus, never the synthetic fixtures."""
import hashlib
import json
from pathlib import Path

import pytest

import knowledge as k
from test_knowledge import (
    test_search_exact_endpoints_and_natural_fit as check_search,
    test_native_endpoint_passages_keep_associated_headings as check_native,
    test_endpoint_and_fit_snippets_include_limits_not_only_code as check_limits,
)

pytestmark = pytest.mark.full_corpus


def test_real_public_corpus_build_and_integrity(tmp_path):
    # Missing files/hash drift is a FAILURE when explicitly requested, not a skip.
    catalog = json.loads((k.ROOT / 'public-source-catalog.json').read_text())['sources']
    expected = {doc['url']: doc for doc in catalog}
    db = tmp_path / 'full-corpus.sqlite'
    report = k.build_index(db)
    assert report['source_count'] == report['hashes_verified'] == len(expected) == 224
    assert report['provider_counts'] == {'hydromancer': 219, 'native': 5}
    with k.connect(db) as conn:
        rows = conn.execute('SELECT * FROM documents').fetchall()
        assert len(rows) == 224
        assert conn.execute("SELECT count(*) FROM passages_fts WHERE passages_fts MATCH 'userFills'").fetchone()[0] > 0
        for row in rows:
            assert k.metadata(row) == expected[row['url']]
            data = Path(row['source_path']).read_bytes()
            assert row['sha256'] == hashlib.sha256(data).hexdigest()
            assert row['body'] == data.decode('utf-8')
            assert row['snapshot_date'][:10] in ('2026-09-14', '2026-09-15')


def test_real_corpus_retrieval_and_endpoint_context(tmp_path):
    check_search(tmp_path)
    check_native(tmp_path)
    check_limits(tmp_path)
