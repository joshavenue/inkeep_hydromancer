"""Contract of the public metadata catalog: no captures or filesystem paths."""
from collections import Counter
from datetime import datetime
import json
import re
from urllib.parse import urlparse

import knowledge as k


def test_public_catalog_is_complete_and_metadata_only():
    catalog = json.loads((k.ROOT / 'public-source-catalog.json').read_text())
    assert catalog['format_version'] == 1
    sources = catalog['sources']
    assert len(sources) == len({s['id'] for s in sources}) == len({s['url'] for s in sources}) == 224
    assert Counter(s['provider'] for s in sources) == {'hydromancer': 219, 'native': 5}
    assert Counter(s['section'] for s in sources) == {'rest-a': 44, 'rest-b': 82, 'websocket': 48, 'platform': 45, 'native': 5}
    fields = {'id', 'url', 'title', 'provider', 'section', 'snapshot_date', 'snapshot_date_basis', 'sha256'}
    for source in sources:
        assert set(source) == fields
        assert re.fullmatch(r'(hydro|native)-[0-9]{1,4}', source['id'])
        assert re.fullmatch(r'[a-f0-9]{64}', source['sha256'])
        assert source['title'] and source['snapshot_date_basis']
        assert datetime.fromisoformat(source['snapshot_date'])
        url = urlparse(source['url'])
        assert url.scheme == 'https'
        assert url.netloc == ('hyperliquid.gitbook.io' if source['provider'] == 'native' else 'docs.hydromancer.xyz')
    assert '/home/' not in json.dumps(catalog)
    assert 'source_path' not in json.dumps(catalog)
