"""Synchronized real SQLite builds; no timing-dependent sleeps or shared temps."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sqlite3
import threading

import pytest

import knowledge as k


@pytest.mark.parametrize('fail_second', [False, True])
def test_concurrent_builders_publish_only_their_closed_complete_index(
        tmp_path, synthetic_corpus, monkeypatch, fail_second):
    db = tmp_path / 'index.sqlite'
    k.build_index(db)
    first_ready, second_incomplete, release_second = (threading.Event() for _ in range(3))
    role = threading.local()
    original_connect, original_replace, original_passages = sqlite3.connect, Path.replace, k.passages
    connections, replaced_closed, temporary_paths = {}, [], []

    class TrackedConnection(sqlite3.Connection):
        closed = False

        def close(self):
            super().close()
            self.closed = True

    def connect(path, *args, **kwargs):
        connection = original_connect(path, *args, **kwargs, factory=TrackedConnection)
        connections[threading.current_thread().name] = connection
        temporary_paths.append(Path(path))
        return connection

    def replace(path, target):
        if target == db and role.name == 'first':
            first_ready.set()
            assert second_incomplete.wait(10), 'Second builder did not reach its open transaction'
        replaced_closed.append(connections[threading.current_thread().name].closed)
        return original_replace(path, target)

    def passages(body, title):
        if role.name == 'second' and not second_incomplete.is_set():
            second_incomplete.set()  # tables exist, document INSERT is not committed
            assert release_second.wait(10), 'Second builder was not released'
            if fail_second:
                raise RuntimeError('Injected second-builder failure')
        yield from original_passages(body, title)

    def build(name):
        role.name = name
        return k.build_index(db)

    monkeypatch.setattr(k.sqlite3, 'connect', connect)
    monkeypatch.setattr(Path, 'replace', replace)
    monkeypatch.setattr(k, 'passages', passages)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(build, 'first')
        second = None
        try:
            assert first_ready.wait(10), 'First builder did not reach publication'
            second = pool.submit(build, 'second')
            report = first.result(timeout=10)
            # Observe publication while the other builder is still incomplete.
            with original_connect(db) as conn:
                published = (conn.execute('SELECT count(*) FROM documents').fetchone()[0],
                             conn.execute('SELECT count(*) FROM passages').fetchone()[0],
                             conn.execute('PRAGMA user_version').fetchone()[0],
                             conn.execute('PRAGMA integrity_check').fetchone()[0])
        finally:
            release_second.set()
        if fail_second:
            with pytest.raises(RuntimeError, match='Injected second-builder failure'):
                second.result(timeout=10)
        else:
            # Capture old shared-temp errors so the primary incomplete-publication
            # assertion below diagnoses the original race, not its later symptom.
            try:
                second.result(timeout=10)
                second_error = None
            except Exception as exc:
                second_error = exc
    assert published == (report['source_count'], report['passage_count'], 1, 'ok')
    if not fail_second:
        assert second_error is None
    assert len(set(temporary_paths)) == 2
    assert all(path.parent == db.parent and path != db for path in temporary_paths)
    assert all(replaced_closed), 'SQLite connections must be closed before atomic publication'
    assert all(connection.closed for connection in connections.values())
    assert not list(tmp_path.glob('*.building*')), 'Only completed index should remain'
    with original_connect(db) as conn:
        assert conn.execute('SELECT count(*) FROM documents').fetchone()[0] == report['source_count']


def test_failed_build_cleans_own_temp_only(tmp_path, synthetic_corpus, monkeypatch):
    db = tmp_path / 'existing.sqlite'
    k.build_index(db)
    before = db.read_bytes()
    foreign = [tmp_path / 'existing.building', tmp_path / 'existing.sqlite.other.building']
    for path in foreign:
        path.write_bytes(b'Another builder owns this file')

    def broken_passages(*args):
        raise RuntimeError('Injected build failure')

    monkeypatch.setattr(k, 'passages', broken_passages)
    with pytest.raises(RuntimeError, match='Injected build failure'):
        k.build_index(db)
    assert db.read_bytes() == before
    assert all(path.read_bytes() == b'Another builder owns this file' for path in foreign)
    assert set(tmp_path.glob('*.building*')) == set(foreign)
