# Public knowledge service

The assistant answers only from this index. It is a deterministic, offline SQLite
FTS5 search over captured public pages, exposed to Inkeep as an official MCP
Streamable HTTP server with two read-only tools (`search_hydromancer_docs`,
`fetch_public_doc`). No model calls, credentials, trading, private research or
live API access are part of this package.

## Sources (closed allowlist)

| Provider | Host | What is captured | Format |
| --- | --- | --- | --- |
| `hydromancer` | `docs.hydromancer.xyz` | every page in the GitBook `llms.txt` index (226 pages on 4 Nov 2026): REST, WebSocket, Reservoir, builder guides, pricing | publisher Markdown (`.md`) |
| `site` | `hydromancer.xyz` | every URL in the public sitemaps (68 pages): products, pricing, customers, blog posts, changelog | HTML main content converted to Markdown |
| `native` | `hyperliquid.gitbook.io` | the Hyperliquid docs sections a builder compares against (82 pages): `for-developers/`, `trading/`, `hypercore/`, HIPs, historical data | publisher Markdown (`.md`) |
| `telegram` | `t.me` | one page: Xeno's public profile (`@xenoflux`, "founder of Hydromancer"), the contact both docs sites point to | HTML converted to Markdown |

Nothing outside these four hosts is ever fetched or indexed. URLs with query
strings, fragments or credentials are rejected. Pages that do not return HTTP 200
are listed in `skipped.json` and never substituted.

## Refresh the index (one command)

```sh
cd knowledge
python3 -m venv .venv            # Python 3.11+ with SQLite FTS5
.venv/bin/python -m pip install -r requirements.lock
.venv/bin/python refresh.py      # capture -> import -> build data/public-docs.sqlite
```

`refresh.py` writes a timestamped `data/capture-*/` (catalog + skipped list) and
`data/snapshot-*/` (page bodies and ledgers), then atomically replaces
`data/public-docs.sqlite`. The whole run takes about three minutes at the default
0.25 s request spacing and prints counts per source. Use `--limit 3` for a smoke
run and `--providers hydromancer site` to refresh a subset. Everything under
`data/` is ignored by Git.

Then start (or restart) the MCP server on the new index:

```sh
HYDROMANCER_KNOWLEDGE_DB="$PWD/data/public-docs.sqlite" .venv/bin/python server.py
curl -s http://127.0.0.1:18581/health
```

The server opens the SQLite file immutably, so a refresh needs a restart to take
effect. Run the refresh on a schedule (daily is enough; the docs and blog change a
few times a week) and restart the server after it.

## Tests

```sh
.venv/bin/python -m pytest -q                 # offline, synthetic fixtures only
.venv/bin/python -m pytest -q --run-protocol  # plus a real MCP SDK round trip on loopback 18582
```

Default tests need no network, server, account or model key. They cover
search/fetch, source-exact excerpts, pagination, path/URL/hash checks, read-only
SQL, import bounds, atomic builds, the HTML-to-Markdown converter, the host
allowlist and a full offline `refresh` against fake responses. `conftest.py`
creates labeled **synthetic fixtures**; never import them into a real assistant.

The optional `--full-corpus` suite validates an operator-supplied copy of the
original September 2026 preview corpus against `public-source-catalog.json`. That
catalog is historical provenance (224 pages); current captures have their own
catalog under `data/`.

## How the pieces fit

- `capture_public_sources.py`: lists pages from the two `llms.txt` indexes and the
  sitemaps, fetches each page over HTTPS without following redirects, converts
  website HTML to Markdown (`<main>` only; navigation, footer, scripts dropped),
  and writes `catalog.json` + `captures/`.
- `import_snapshot.py`: validates a catalog (host, ID pattern, hash, UTF-8, 2 MiB
  limit, no path escapes) and writes the ledger layout `knowledge.py` reads. It
  refuses to overwrite an existing directory.
- `knowledge.py`: re-verifies every hash and URL, builds passages with their
  Markdown headings, and serves `search` (BM25 plus endpoint-name and intent
  boosts) and `fetch` (10,000-character pages) from a read-only connection.
- `server.py`: FastMCP Streamable HTTP on `127.0.0.1:18581/mcp` with a `/health`
  route that reports source counts and snapshot dates.

Document IDs are `hydro-N`, `site-N` and `native-N`. Search results carry the
original URL, title, snapshot date and basis, SHA-256, provider and section, plus a
source-exact excerpt; the model is instructed to cite only those URLs.

## Manual captures

The importer also accepts hand-reviewed captures: put `<id>.md` / `<id>.txt` files
in a directory, describe them in a `format_version: 1` catalog with the fields
shown in `public-source-catalog.json` (plus a current `snapshot_date` and
`snapshot_date_basis`), then run `import_snapshot.py --catalog ... --captures ...
--output data/<new-dir>` and `knowledge.py` with the four `*_SNAPSHOT_ROOT`
variables pointing at that directory. Each record must name its own retrieval
date; historical dates are applied only when URL and bytes match the historical
catalog exactly.

## Public-commit boundary

Keep `data/`, `snapshots/`, `.test-tmp/`, `.venv/`, `manifest.json`, SQLite/build
files, PID/log files and receipts ignored. Only the catalog, source, tests,
instructions and dependency lock belong in the public repository.