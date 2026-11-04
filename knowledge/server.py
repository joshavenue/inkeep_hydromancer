"""Official MCP Streamable HTTP; public, local, read-only knowledge tools."""
import argparse
import os
from pathlib import Path
from typing import Annotated

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations
from pydantic import Field
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import JSONResponse
import uvicorn

from knowledge import DB, ROOT, EVIDENCE_POLICY, connect, fetch, search
from contracts import DOCUMENT_ID_PATTERN, MAX_FETCH_OFFSET

mcp = FastMCP('Hydromancer public snapshot search', instructions=EVIDENCE_POLICY,
              host='127.0.0.1', port=18581, streamable_http_path='/mcp',
              stateless_http=True, json_response=True, max_request_body_size=32768)
READONLY = ToolAnnotations(readOnlyHint=True, destructiveHint=False,
                           idempotentHint=True, openWorldHint=False)


@mcp.tool(annotations=READONLY)
def search_hydromancer_docs(
    query: Annotated[str, Field(min_length=1, max_length=500)],
    limit: Annotated[int, Field(ge=1, le=8)] = 6,
) -> dict:
    """Search public docs.hydromancer.xyz, hydromancer.xyz and Hyperliquid API docs.

    Handles exact endpoint names and plain questions (copytrading, batching,
    Reservoir archives, native limits, pricing). Returns source-exact excerpts
    with citation URLs and snapshot dates. Use limit=8 for comparisons.
    """
    return search(query, limit)


@mcp.tool(annotations=READONLY)
def fetch_public_doc(
    id: Annotated[str, Field(pattern=DOCUMENT_ID_PATTERN, max_length=16)],
    offset: Annotated[int, Field(ge=0, le=MAX_FETCH_OFFSET)] = 0,
) -> dict:
    """Fetch up to 10,000 characters of a public document by its search result ID.

    Continue with next_offset for long documents. No arbitrary file/URL access.
    """
    return fetch(id, offset)


@mcp.custom_route('/health', methods=['GET'])
async def health(request):
    with connect() as conn:
        count = conn.execute('SELECT count(*) FROM documents').fetchone()[0]
        passages = conn.execute('SELECT count(*) FROM passages').fetchone()[0]
        providers = dict(conn.execute('SELECT provider,count(*) FROM documents GROUP BY provider'))
        dates = [row[0] for row in conn.execute(
            'SELECT DISTINCT substr(snapshot_date,1,10) FROM documents ORDER BY 1')]
    return JSONResponse({'status': 'ok', 'read_only': True, 'source_count': count,
                         'passage_count': passages, 'provider_counts': providers,
                         'snapshot_dates': dates,
                         'transport': 'streamable-http', 'mcp_path': '/mcp'})


def app():
    return TrustedHostMiddleware(mcp.streamable_http_app(), allowed_hosts=['127.0.0.1', 'localhost'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, choices=[18581, 18582], default=18581)
    args = parser.parse_args()
    if not DB.is_file():
        raise SystemExit('Build approved index first: .venv/bin/python knowledge.py')
    pidfile = ROOT / ('server.pid' if args.port == 18581 else 'test-server.pid')
    pidfile.write_text(str(os.getpid()) + '\n')
    try:
        uvicorn.run(app(), host='127.0.0.1', port=args.port, access_log=True,
                    limit_concurrency=32, timeout_keep_alive=10)
    finally:
        if pidfile.exists() and pidfile.read_text().strip() == str(os.getpid()):
            pidfile.unlink()
