"""Importer tests use synthetic bytes and an isolated catalog, not real docs."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import pytest

import knowledge as k


@pytest.fixture
def import_inputs(tmp_path):
    captures = tmp_path / 'captures'
    captures.mkdir()
    data = b'SYNTHETIC TEST FIXTURE, NOT EVIDENCE.\n'
    (captures / 'hydro-7.md').write_bytes(data)
    source = {'id': 'hydro-7', 'provider': 'hydromancer', 'section': 'platform',
              'url': 'https://docs.hydromancer.xyz/synthetic-demo.md', 'title': 'Demo',
              'sha256': hashlib.sha256(data).hexdigest(), 'snapshot_date': '2026-01-01',
              'snapshot_date_basis': 'synthetic fixture'}
    return captures, source, tmp_path / 'catalog.json', tmp_path / 'output'


@pytest.mark.parametrize('change', [
    {'sha256': '0' * 64}, {'id': '../escape'}, {'id': 'native-7'},
    {'provider': 'private'}, {'section': 'private'}, {'section': 'native'},
    {'url': 'https://docs.hydromancer.xyz.evil.example/page'},
    {'url': 'https://docs.hydromancer.xyz@evil.example/page'},
    {'url': 'http://docs.hydromancer.xyz/page'}, {'url': 'https://notion.so/private'},
    {'snapshot_date': 'unknown'}, {'snapshot_date_basis': ''}, {'title': ''},
])
def test_import_rejects_invalid_metadata_before_writing(import_inputs, change):
    from import_snapshot import import_snapshot
    captures, source, catalog, output = import_inputs
    catalog.write_text(json.dumps({'format_version': 1, 'sources': [dict(source, **change)]}))
    with pytest.raises(ValueError):
        import_snapshot(catalog, captures, output)
    assert not output.exists()


@pytest.mark.parametrize('case', ['empty', 'too_many', 'duplicate_id', 'duplicate_url', 'format'])
def test_import_rejects_invalid_catalog_shape(import_inputs, case):
    from import_snapshot import import_snapshot
    captures, source, catalog, output = import_inputs
    sources = [source]
    if case == 'empty':
        sources = []
    elif case == 'too_many':
        sources *= 225
    elif case == 'duplicate_id':
        sources.append(dict(source, url='https://docs.hydromancer.xyz/other'))
    elif case == 'duplicate_url':
        sources.append(dict(source, id='hydro-8'))
    catalog.write_text(json.dumps({'format_version': 2 if case == 'format' else 1, 'sources': sources}))
    with pytest.raises(ValueError):
        import_snapshot(catalog, captures, output)
    assert not output.exists()


@pytest.mark.parametrize('case', ['symlink', 'oversized', 'non_utf8'])
def test_import_rejects_unsafe_capture_before_writing(import_inputs, case):
    from import_snapshot import import_snapshot
    captures, source, catalog, output = import_inputs
    file = captures / 'hydro-7.md'
    if case == 'symlink':
        outside = captures.parent / 'outside.md'
        outside.write_bytes(file.read_bytes())
        file.unlink()
        file.symlink_to(outside)
    else:
        data = b'x' * (2 * 1024 * 1024 + 1) if case == 'oversized' else b'\xff'
        file.write_bytes(data)
        source['sha256'] = hashlib.sha256(data).hexdigest()
    catalog.write_text(json.dumps({'format_version': 1, 'sources': [source]}))
    with pytest.raises(ValueError):
        import_snapshot(catalog, captures, output)
    assert not output.exists()


def test_import_never_overwrites_existing_directory(import_inputs):
    from import_snapshot import import_snapshot
    captures, source, catalog, output = import_inputs
    catalog.write_text(json.dumps({'format_version': 1, 'sources': [source]}))
    output.mkdir()
    sentinel = output / 'keep.txt'
    sentinel.write_text('Keep existing operator data')
    with pytest.raises(FileExistsError):
        import_snapshot(catalog, captures, output)
    assert sentinel.read_text() == 'Keep existing operator data'


def test_import_operator_snapshot_then_build_and_search(tmp_path, monkeypatch):
    assert importlib.util.find_spec('import_snapshot') is not None, 'Provide a local, hash-checked snapshot importer'
    from import_snapshot import import_snapshot
    captures = tmp_path / 'captures'
    captures.mkdir()
    text = b'SYNTHETIC TEST FIXTURE, NOT EVIDENCE.\n# Demo\nuserFills fixture.\n'
    (captures / 'hydro-7.md').write_bytes(text)
    (captures / 'native-8.txt').write_bytes(text)
    common = {'title': 'Demo', 'sha256': hashlib.sha256(text).hexdigest(),
              'snapshot_date': '2026-01-01', 'snapshot_date_basis': 'synthetic fixture'}
    catalog = tmp_path / 'catalog.json'
    catalog.write_text(json.dumps({'format_version': 1, 'sources': [
        dict(common, id='hydro-7', provider='hydromancer', section='platform',
             url='https://docs.hydromancer.xyz/synthetic-demo.md'),
        dict(common, id='native-8', provider='native', section='native',
             url='https://hyperliquid.gitbook.io/synthetic-demo')]}))
    destination = tmp_path / 'snapshot'
    assert import_snapshot(catalog, captures, destination) == 2
    for ledger in destination.rglob('*.json'):
        for record in json.loads(ledger.read_text()):
            assert not Path(record.get('path', record.get('file'))).is_absolute()
    monkeypatch.setattr(k, 'HYDRO', destination / 'hydromancer')
    monkeypatch.setattr(k, 'NATIVE', destination / 'native')
    db = tmp_path / 'import.sqlite'
    report = k.build_index(db)
    assert report['source_count'] == report['hashes_verified'] == 2
    results = k.search('userFills', db=db)['results']
    assert {r['id'] for r in results} == {'hydro-7', 'native-8'}
    assert all(r['snapshot_date'] == '2026-01-01' for r in results)
    assert k.fetch('hydro-7', db=db)['text'] == text.decode()
    # Exercise the real offline CLI too; no network or source-tree data needed.
    cli = subprocess.run([sys.executable, str(k.ROOT / 'import_snapshot.py'),
                          '--catalog', str(catalog), '--captures', str(captures),
                          '--output', str(tmp_path / 'cli-snapshot')],
                         cwd=tmp_path, capture_output=True, text=True)
    assert cli.returncode == 0, cli.stderr
    assert json.loads(cli.stdout)['imported'] == 2
