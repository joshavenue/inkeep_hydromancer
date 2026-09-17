"""Offline health metadata must describe the actual selected index."""
import asyncio
import json

import knowledge as k
import server


def test_health_reports_actual_snapshot_dates(tmp_path, synthetic_corpus, monkeypatch):
    db = tmp_path / 'health.sqlite'
    report = k.build_index(db)
    monkeypatch.setattr(server, 'connect', lambda: k.connect(db))
    response = asyncio.run(server.health(None))
    metadata = json.loads(response.body)
    assert metadata['source_count'] == report['source_count'] == 10
    assert metadata['provider_counts'] == report['provider_counts']
    assert metadata['snapshot_dates'] == ['2026-01-01']
    assert metadata['read_only'] is True
