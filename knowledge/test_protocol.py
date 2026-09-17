"""Opt-in real SDK/loopback HTTP against SYNTHETIC fixtures, not real docs."""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

import httpx
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

ROOT = Path(__file__).resolve().parent
pytestmark = pytest.mark.protocol


def test_streamable_http_protocol_and_bounds(tmp_path, synthetic_corpus):
    import knowledge as k
    db = tmp_path / 'protocol.sqlite'
    report = k.build_index(db)
    env = dict(os.environ, HYDROMANCER_KNOWLEDGE_DB=str(db))
    # Never accidentally exercise an unrelated service that owns this port.
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 18582))
    assert importlib.util.find_spec('server') is not None, 'Official MCP server must exist'
    log = (tmp_path / 'protocol-test-server.log').open('w')
    process = subprocess.Popen([sys.executable, str(ROOT / 'server.py'), '--port', '18582'],
                               cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    try:
        deadline = time.monotonic() + 15
        while True:
            assert process.poll() is None, 'MCP server exited early; inspect protocol-test-server.log'
            try:
                health = httpx.get('http://127.0.0.1:18582/health', timeout=0.5)
                if health.status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            assert time.monotonic() < deadline, 'MCP health readiness timed out'
            time.sleep(0.05)
        assert health.json()['source_count'] == report['source_count'] == 10
        assert health.json()['snapshot_dates'] == ['2026-01-01']
        assert health.json()['read_only'] is True
        receipt = asyncio.run(exercise('http://127.0.0.1:18582/mcp'))
        assert set(receipt['tools']) == {'search_hydromancer_docs', 'fetch_public_doc'}
        assert receipt['exact_endpoint']['results'][0]['title'] == 'batchClearinghouseStates'
        assert receipt['copytrading']['results']
        assert receipt['fetched']['id'] == 'hydro-132'
        assert len(receipt['fetched']['text']) <= 10000
        assert all(receipt['errors'].values())
        oversized = httpx.post('http://127.0.0.1:18582/mcp', content=b'x' * 33000,
                               headers={'content-type':'application/json', 'accept':'application/json, text/event-stream'})
        assert oversized.status_code == 413
        assert httpx.get('http://127.0.0.1:18582/manifest.json').status_code == 404
        assert httpx.get('http://127.0.0.1:18582/health', headers={'Host':'evil.example'}).status_code in (400, 421)
        (tmp_path / 'protocol-test-receipt.json').write_text(json.dumps(receipt, indent=2))
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        finally:
            log.close()
            # Uvicorn can re-raise SIGTERM before server.py's outer finally.
            # Only remove the PID file belonging to this terminated child.
            pidfile = ROOT / 'test-server.pid'
            if pidfile.exists() and pidfile.read_text().strip() == str(process.pid):
                pidfile.unlink()
    assert not (ROOT / 'test-server.pid').exists(), 'Temporary protocol server PID file leaked'


async def exercise(url):
    async with streamable_http_client(url) as (read, write, _):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            tools = await session.list_tools()
            for t in tools.tools:
                assert t.annotations.readOnlyHint is True
                assert t.annotations.openWorldHint is False
            receipt = {'protocol_version': init.protocolVersion, 'server': init.serverInfo.model_dump(),
                       'tools': [t.name for t in tools.tools], 'errors': {}}
            cases = [('exact_endpoint', 'search_hydromancer_docs', {'query':'batchClearinghouseStates', 'limit':2}),
                     ('copytrading', 'search_hydromancer_docs', {'query':'Is Hydromancer a good fit for a copytrading bot?', 'limit':8}),
                     ('fetched', 'fetch_public_doc', {'id':'hydro-132'})]
            for label, tool, args in cases:
                result = await session.call_tool(tool, args)
                assert not result.isError
                receipt[label] = result.structuredContent or json.loads(result.content[0].text)
            for label, tool, args in [('too_many', 'search_hydromancer_docs', {'query':'userFills','limit':9}),
                                      ('too_long', 'search_hydromancer_docs', {'query':'x'*501}),
                                      ('path_read', 'fetch_public_doc', {'id':'/etc/passwd'}),
                                      ('url_read', 'fetch_public_doc', {'id':'https://example.com'}),
                                      ('unknown_tool', 'write_file', {'path':'anything'})]:
                receipt['errors'][label] = (await session.call_tool(tool, args)).isError
            return receipt
