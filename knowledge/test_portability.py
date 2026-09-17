"""Portability tests; generated text below is synthetic, never source evidence."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

import knowledge as k


def inspect_configuration(env):
    result = subprocess.run(
        [sys.executable, '-c',
         'import json, knowledge as k; print(json.dumps([str(k.HYDRO), str(k.NATIVE), str(k.DB)]))'],
        cwd=k.ROOT, env=env, check=True, text=True, capture_output=True,
    )
    return json.loads(result.stdout)


def test_relative_ledger_paths_and_capture_dates(synthetic_corpus):
    for root, name, field in ((k.HYDRO, 'rest-a-assignment.json', 'path'),
                              (k.NATIVE, 'source_records.json', 'file')):
        ledger = root / name
        rows = json.loads(ledger.read_text())
        for row in rows:
            row[field] = str(Path(row[field]).relative_to(root))
        ledger.write_text(json.dumps(rows))
    docs = list(k.approved_sources())
    assert len(docs) == sum(len(rows) for rows in synthetic_corpus.values())
    for doc in docs:
        assert doc['snapshot_date'] == '2026-01-01'
        assert doc['snapshot_date_basis'] == 'synthetic test fixture date, not capture time'
        assert doc['sha256'] == hashlib.sha256(Path(doc['source_path']).read_bytes()).hexdigest()


@pytest.mark.parametrize('native', [False, True])
@pytest.mark.parametrize('escape', ['parent', 'symlink', 'directory_symlink', 'suffix'])
def test_snapshot_path_checks_survive_portable_roots(tmp_path, synthetic_corpus, native, escape):
    root = k.NATIVE if native else k.HYDRO
    ledger = root / ('source_records.json' if native else 'rest-a-assignment.json')
    record = json.loads(ledger.read_text())[0]
    field = 'file' if native else 'path'
    original = Path(record[field])
    if escape == 'parent':
        record[field] = '../outside.txt' if native else '../outside.md'
    elif escape == 'symlink':
        outside = tmp_path / ('outside.txt' if native else 'outside.md')
        outside.write_bytes(original.read_bytes())
        link = original.parent / ('link.txt' if native else 'link.md')
        link.symlink_to(outside)
        record[field] = str(link.relative_to(root))
    elif escape == 'directory_symlink':
        # A valid hash and a contained filename do not authorize an escaping
        # sources/pages directory. Move the whole directory, not just one file.
        outside = tmp_path / 'outside-pages'
        original.parent.rename(outside)
        original.parent.symlink_to(outside, target_is_directory=True)
        record[field] = str(original.relative_to(root))
    else:
        wrong = original.with_suffix('.json')
        wrong.write_bytes(original.read_bytes())
        record[field] = str(wrong.relative_to(root))
    ledger.write_text(json.dumps([record]))
    db = tmp_path / 'existing.sqlite'
    db.write_bytes(b'Existing index must not be replaced by invalid input')
    with pytest.raises(ValueError, match='outside public page directory'):
        k.build_index(db)
    assert db.read_bytes() == b'Existing index must not be replaced by invalid input'


def test_conflicting_duplicate_url_is_rejected(synthetic_corpus):
    ledger = k.HYDRO / 'rest-a-assignment.json'
    rows = json.loads(ledger.read_text())
    rows[1]['url'] = rows[0]['url']
    ledger.write_text(json.dumps(rows))
    with pytest.raises(ValueError, match='Conflicting duplicate URL'):
        list(k.approved_sources())


def test_snapshot_and_database_roots_are_portable(tmp_path):
    env = {key: value for key, value in os.environ.items() if key not in (
        'HYDROMANCER_SNAPSHOT_ROOT', 'HYPERLIQUID_SNAPSHOT_ROOT', 'HYDROMANCER_KNOWLEDGE_DB')}
    assert inspect_configuration(env) == [str(k.ROOT / 'snapshots/hydromancer'),
                                          str(k.ROOT / 'snapshots/native'),
                                          str(k.ROOT / 'public-docs.sqlite')]
    expected = [str(tmp_path / name) for name in ('hydro', 'native', 'index.sqlite')]
    env.update(dict(zip(('HYDROMANCER_SNAPSHOT_ROOT', 'HYPERLIQUID_SNAPSHOT_ROOT',
                         'HYDROMANCER_KNOWLEDGE_DB'), expected)))
    assert inspect_configuration(env) == expected
