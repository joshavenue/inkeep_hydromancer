"""Bounded SQL candidate materialization without changing ranking or deduping."""
import hashlib
import json
from pathlib import Path
import sqlite3
import tracemalloc

import pytest

import knowledge as k


@pytest.mark.parametrize('embedded_nul', [False, True])
def test_search_does_not_materialize_full_documents_per_passage(
        tmp_path, synthetic_corpus, monkeypatch, embedded_nul, record_property):
    ledger = k.HYDRO / 'rest-a-assignment.json'
    rows = json.loads(ledger.read_text())
    record = rows[0]
    size = 2 * 1024 * 1024
    line = b'SYNTHETIC TEST FIXTURE userFillsByTime, not documentation.\n'
    if embedded_nul:
        line = line.replace(b'FIXTURE', b'FIXTURE\x00')
    data = (line * (size // len(line) + 1))[:size]
    Path(record['path']).write_bytes(data)
    record['sha256'] = hashlib.sha256(data).hexdigest()
    ledger.write_text(json.dumps(rows))
    db = tmp_path / 'search.sqlite'
    k.build_index(db)
    real_connect = k.connect
    candidate_count = 0
    body_reads = 0

    def bounded_connect(path):
        conn = real_connect(path)

        def bounded_row(cursor, values):
            nonlocal candidate_count, body_reads
            columns = [column[0] for column in cursor.description]
            if columns == ['body']:
                body_reads += 1
            if 'rank' in columns:
                candidate_count += 1
                # Fail on the first candidate on regression rather than letting
                # the old SELECT d.* allocate >1 GiB across >500 matching rows.
                assert 'body' not in columns and 'source_path' not in columns
                assert all(not isinstance(value, str) or len(value) <= k.MAX_PASSAGE for value in values)
            return sqlite3.Row(cursor, values)

        conn.row_factory = bounded_row
        return conn

    monkeypatch.setattr(k, 'connect', bounded_connect)
    tracemalloc.start()
    try:
        hits = k.search('userFillsByTime', 8, db=db)['results']
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert candidate_count > 500
    assert peak < 16 * 1024 * 1024, f'Search allocated {peak} bytes'
    assert body_reads == len(hits)
    record_property('candidate_rows', candidate_count)
    record_property('body_reads', body_reads)
    record_property('peak_python_bytes', peak)
    assert len({hit['id'] for hit in hits}) == len(hits)
    first = hits[0]
    assert first['id'] == 'hydro-' + str(record['id'])
    assert first['start_offset'] == 0  # endpoint ranking still favors introduction
    assert first['excerpt'] == data[:first['end_offset']].decode()
    assert first['context_excerpt'] == data[:1000].decode()
    assert first['document_chars'] == size
