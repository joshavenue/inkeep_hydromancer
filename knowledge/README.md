# Public snapshot knowledge service

The existing SQLite FTS5 retriever and official MCP Streamable HTTP tools are
preserved. Search is deterministic and offline; fetching accepts known document
IDs only. SQLite connections remain read-only/query-only. No TypeSafe integration,
model calls, trading, credentials, private research ingestion, or deployment is
part of this package.

## What is (and is not) published

`public-source-catalog.json` contains **224 historical public source records**:
219 Hydromancer and 5 native Hyperliquid documents. It is a field-whitelisted
projection of the original preview's index manifest: URL, title, provider, section,
ID, snapshot date/date basis, and SHA-256. It contains no filesystem paths or source
bodies. Hydromancer's historical date is a corpus date, not an exact capture time.

**The catalog is not a corpus.** No production documents, database, generated
manifest, research folder, chat history, or server receipts are shipped. Hashes
identify the historical captured bytes; a current website response or a different
HTML-to-text conversion will generally have a different hash. A hash match verifies
bytes, not the truth, ownership, freshness, or completeness of a source.

`conftest.py` creates ten explicitly labeled **synthetic test fixtures** in a test
temporary directory. Their prose/numbers exercise mechanics and are not product
claims or production evidence. Never import them into a real assistant.

## Environment and offline tests

Python 3.11+ with SQLite FTS5 is required. From the repository root:

```sh
cd knowledge
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
.venv/bin/python -m pytest -q
```

Default tests need no corpus, server, network, account, or model key. They cover
search/fetch, source-exact excerpts, pagination, path/URL/hash checks, read-only SQL,
import bounds, and actual index metadata. Regressions include whole-directory
symlink escapes, synchronized concurrent builds, full 2 MiB pagination through
direct fetch and in-memory MCP, and bounded search candidate allocation. The
optional HTTP protocol/full-corpus tests are reported as **skipped**, not passed.

```sh
# Real official MCP SDK over temporary loopback HTTP using synthetic fixtures.
# Requires port 18582 free; starts/terminates its own child, logs under .test-tmp/.
.venv/bin/python -m pytest -q --run-protocol

# Optional original-corpus validation; explicit roots only, never auto-discovery.
HYDROMANCER_SNAPSHOT_ROOT=/absolute/path/to/hydromancer-snapshot \
HYPERLIQUID_SNAPSHOT_ROOT=/absolute/path/to/native-snapshot \
  .venv/bin/python -m pytest -q --full-corpus
```

`--full-corpus` requires the original 224 historical documents/ledgers, validates
all catalog metadata and byte hashes, and runs the original retrieval/endpoint
context checks. Missing files or changed hashes **fail** when explicitly enabled.
It is not suitable for a partial/current recapture. Neither smoke test establishes
a deployed Inkeep chat/model/widget integration.

## Build from an operator-supplied snapshot

Preferred portable import format:

1. Obtain reviewed public UTF-8 captures from an authorized operator. Put them in
   `knowledge/data/captures/` (ignored), named `<id>.md` for Hydromancer and
   `<id>.txt` for native sources, e.g. `hydro-4.md`, `native-1.txt`.
2. For the historical corpus, supply every file named in the committed catalog,
   **without changing its expected hash**. For a reviewed subset, save a separate
   catalog under `data/` with only those records; retain the same object format
   (`format_version: 1`, `sources: [...]`). Do not overwrite the historical catalog.
3. Import and build:

```sh
.venv/bin/python import_snapshot.py --captures data/captures
.venv/bin/python knowledge.py
```

The importer is local-only, examines explicit IDs (no walking/discovery), allows
1–224 entries and at most 2 MiB per document, verifies provider/section/ID and exact
HTTPS hostname, rejects escaping paths/symlinks, checks UTF-8/SHA-256, and validates
all input before creating output. It refuses an existing output directory. It
writes the existing five ledger formats with relative paths under `snapshots/`.
Use `--catalog data/reviewed-catalog.json --output data/new-snapshots` for a
separate reviewed import; point the roots below at that new directory afterward.

These ledgers record the operator's assertion of a successful, reviewed public
capture (`status=200`, `markdown_valid=true` for Hydromancer). **The importer does
not fetch or prove HTTP provenance, validate Markdown semantics, or authenticate a
publisher.** Review the body, originating URL and capture receipt before import.
Do not label analyst summaries, HTML login/error pages, or model-generated text as
captured documentation.

Existing operator ledgers can also be used directly without copying:

| Variable | Default (relative to this directory) |
| --- | --- |
| `HYDROMANCER_SNAPSHOT_ROOT` | `snapshots/hydromancer` |
| `HYPERLIQUID_SNAPSHOT_ROOT` | `snapshots/native` |
| `HYDROMANCER_KNOWLEDGE_DB` | `public-docs.sqlite` |

Hydromancer expects `rest-a-assignment.json`, `rest-b-assignment.json`,
`websocket-assignment.json`, `platform-assignment.json`, and `sources/*.md`.
Native expects `source_records.json` and `pages/*.txt`. Relative ledger paths resolve
against their respective snapshot root, not the working directory. Legacy absolute
paths still must resolve *inside* the selected `sources/` or `pages/` directory;
that directory must itself resolve inside the configured snapshot root. Never make
the allowed root an entire home/research directory. Every hash and the exact URL
allowlist are checked again before index replacement.

Direct ledgers share the importer's 2 MiB **byte** limit and public ID contract:
`hydro-` or `native-` followed by one to four ASCII digits. The constructed ID is
validated without trimming, numeric coercion, or other repair. Oversize documents
and malformed IDs fail before creating a temporary index; an existing index is
unchanged. UTF-8 character offsets may range from 0 through 2,097,152 in both fetch
and MCP, so every returned `next_offset` remains followable. Pages still contain
at most 10,000 characters.

Snapshot provenance is selected in this order:

1. Explicit `snapshot_date` and nonempty `snapshot_date_basis` (valid ISO date/time).
2. Otherwise, the supplied `retrieved_at`, with basis exactly `retrieved_at`.
3. Otherwise, the historical catalog date/basis only when **both URL and verified
   byte hash match** a catalog entry. All other captures require provenance.

Invalid explicit metadata is rejected, not silently replaced with a historical date.

```sh
HYDROMANCER_SNAPSHOT_ROOT=/absolute/path/to/hydromancer-snapshot \
HYPERLIQUID_SNAPSHOT_ROOT=/absolute/path/to/native-snapshot \
HYDROMANCER_KNOWLEDGE_DB="$PWD/data/public-docs.sqlite" \
  .venv/bin/python knowledge.py
```

The generated `manifest.json` contains local paths; keep it private/ignored. Set the
same database variable for `server.py` if using a nondefault index. A missing index
is an error, not a reason to silently load fixtures. Index building does not start
a server. Rebuilding a live immutable SQLite index requires restarting its reader.
Each builder exclusively creates its own unique `*.building` file beside the
destination, commits and closes SQLite before atomic replacement, and cleans only
its own temporary file on failure. Concurrent successful builds are last-writer-wins,
but each published index is complete. Interrupted build files and SQLite sidecars
remain ignored. Search preserves ranking/deduplication and loads full document
bodies only for selected unique results, not once per matching passage.

## Capture current public documentation instead

Current captures are a **new snapshot**, not a reconstruction of the old hashes.
Choose catalog URLs explicitly; do not recursively mirror sites or fetch private
Notion/research URLs. Respect the publisher's terms/rate limits. The importer and
builder allow only `https://docs.hydromancer.xyz` and
`https://hyperliquid.gitbook.io` for their corresponding providers.

For a bounded **one-document** Hydromancer example, from `knowledge/`:

```sh
mkdir -p data/captures
# No redirect following; stop unless the exact approved URL returned HTTP 200.
test "$(curl --proto '=https' --max-time 30 --max-filesize 2097152 \
  --fail --silent --show-error --output data/captures/hydro-4.md \
  --write-out '%{http_code}' \
  'https://docs.hydromancer.xyz/readme/rest-api/user-position-data.md')" = 200
```

**Stop if that command fails.** Inspect the saved body as UTF-8 Markdown and confirm
it is documentation rather than HTML/error/authentication content. Save the real
HTTP/capture receipt locally. Only after review, create a separate catalog:

```sh
.venv/bin/python - <<'PY'
from datetime import datetime, timezone
import hashlib, json
from pathlib import Path
historical = json.loads(Path('public-source-catalog.json').read_text())
source = dict(next(s for s in historical['sources'] if s['id'] == 'hydro-4'))
source['sha256'] = hashlib.sha256(Path('data/captures/hydro-4.md').read_bytes()).hexdigest()
source['snapshot_date'] = datetime.now(timezone.utc).isoformat()
source['snapshot_date_basis'] = 'operator-reviewed public HTTP 200 capture; recorded immediately after capture'
Path('data/reviewed-catalog.json').write_text(json.dumps({'format_version': 1, 'sources': [source]}, indent=2) + '\n')
PY
.venv/bin/python import_snapshot.py --catalog data/reviewed-catalog.json \
  --captures data/captures
.venv/bin/python knowledge.py
```

Use the actual retrieval timestamp if the review was delayed. Native GitBook pages
need a reviewed public plain-text export: save UTF-8 `.txt`, cite the canonical
public URL, and hash the *saved text bytes*, not the HTML response. Select additional
sources deliberately and record their actual dates. A one-document build is only a
one-document index and cannot substantiate broad product-fit answers. Failed or
blocked captures remain missing; never substitute fabricated production documents.

## Public-commit boundary

Keep `data/`, `snapshots/`, `.test-tmp/`, `.venv/`, `manifest.json`, SQLite/build
files, PID/log files, and receipts ignored. Only the catalog, source, tests,
instructions and dependency lock belong in the public repository. Review `git status`
and the staged diff before any commit; this package does not auto-stage or push.
