"""Small synthetic fixtures. NOT captures, product facts, or production documents."""
import hashlib
import json

import pytest

import knowledge as k


def pytest_addoption(parser):
    parser.addoption('--run-protocol', action='store_true', help='Run a temporary loopback MCP SDK smoke test')
    parser.addoption('--full-corpus', action='store_true', help='Validate an operator-supplied original 224-page snapshot')


def pytest_collection_modifyitems(config, items):
    for item in items:
        for marker, option in (('protocol', '--run-protocol'), ('full_corpus', '--full-corpus')):
            if marker in item.keywords and not config.getoption(option):
                item.add_marker(pytest.mark.skip(reason=f'Optional test: pass {option} explicitly'))


@pytest.fixture
def synthetic_corpus(tmp_path, monkeypatch):
    """Exercise index mechanics only; these deliberately tiny texts are invented."""
    hydro, native = tmp_path / 'hydro', tmp_path / 'native'
    (hydro / 'sources').mkdir(parents=True)
    (native / 'pages').mkdir(parents=True)
    cases = [
        ('hydro-1', 'userFillsByTime', 'rest-a', 'userFillsByTime historical fills example.'),
        ('hydro-2', 'batchClearinghouseStates', 'rest-a', 'batchClearinghouseStates example: 1000 users and 100 users.'),
        ('hydro-3', 'l2BookDiffSnapshot', 'rest-b', 'l2BookDiffSnapshot example book snapshot.'),
        ('hydro-4', 'Copytrading and social trading', 'platform', 'copytrading example userFills batching.'),
        ('hydro-5', 'userFills', 'websocket', 'userFills example stream of fills.'),
        ('hydro-132', 'Session Management and Reconnection', 'websocket',
         'session reconnect replay example: 30 seconds since sent.\n' + 'SYNTHETIC continuation; not evidence.\n' * 350),
        ('hydro-6', 'Pricing', 'platform', 'pricing example plans tokens limits.'),
        ('native-1', 'Info endpoint | Hyperliquid Docs', 'native',
         'Previous endpoint\nPOST https://api.hyperliquid.xyz/info\nOther text.\n'
         'Retrieve fills by time\nPOST https://api.hyperliquid.xyz/info\n'
         'userFillsByTime synthetic numeric example: 2000 and 10000.\n'
         'Next endpoint\nPOST https://api.hyperliquid.xyz/info\nNo fills here.'),
        ('native-2', 'Rate limits and user limits | Hyperliquid Docs', 'native', 'native websocket rate limits example.'),
        ('native-3', 'Historical data | Hyperliquid Docs', 'native', 'historical data example exports.'),
    ]
    records = {section: [] for section in ('rest-a', 'rest-b', 'websocket', 'platform', 'native')}
    for identifier, title, section, prose in cases:
        is_native = section == 'native'
        root = native if is_native else hydro
        relative = f'pages/{identifier}.txt' if is_native else f'sources/{identifier}.md'
        body = 'SYNTHETIC TEST FIXTURE — NOT DOCUMENTATION OR PRODUCT FACTS.\n'
        body += ('' if is_native else f'# {title}\n') + prose + '\n'
        path = root / relative
        path.write_text(body, encoding='utf-8')
        sha = hashlib.sha256(path.read_bytes()).hexdigest()
        record = {'id': identifier.split('-')[1], 'title': title, 'status': 200,
                  'url': ('https://hyperliquid.gitbook.io/' if is_native else 'https://docs.hydromancer.xyz/') + f'synthetic-test/{identifier}',
                  'retrieved_at': '2026-01-01T00:00:00+00:00', 'snapshot_date': '2026-01-01',
                  'snapshot_date_basis': 'synthetic test fixture date, not capture time'}
        if is_native:
            record.update(file=str(path), sha256_text=sha)
        else:
            record.update(path=str(path), sha256=sha, markdown_valid=True)
        records[section].append(record)
    for section, rows in records.items():
        ledger = native / 'source_records.json' if section == 'native' else hydro / f'{section}-assignment.json'
        ledger.write_text(json.dumps(rows), encoding='utf-8')
    monkeypatch.setattr(k, 'HYDRO', hydro)
    monkeypatch.setattr(k, 'NATIVE', native)
    return records
