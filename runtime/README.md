# Local Inkeep runtime

This is the actual released **Inkeep 0.80.6** demo, not a replacement chatbot.
`agents-api`, `agents-core`, and `agents-sdk` remain pinned to 0.80.6; Zod is pinned
and overridden to **4.3.6** for this release's schema compatibility. Preserve
`pnpm-lock.yaml` and use a frozen install. The default remains `custom/grok-4.6`,
with a configured 500,000-token context and **1,200-token output cap**. The
scoped-Yes prompt, retrieval evidence gate, classic execution, step and transfer
limits remain in `project.mjs`.

No live App IDs, credentials, databases, migration snapshots or historical chat
logs are included. No TypeSafe integration is present. Nothing here creates a
hosted account, starts a tunnel, changes Docker/system units, or provisions a
model endpoint automatically. This is not a one-command deployment.

## 1. Offline checks and local configuration

Use Node 24 (offline tests exercised with 24.16.0). From `runtime/`:

```sh
node --test
node scripts/setup-local.mjs
# Runtime dependencies require registry access:
npx --yes pnpm@10.33.0 install --frozen-lockfile
```

`node --test` needs neither installed Inkeep packages nor services, `.env` or an
App ID. All nine live checks skip by default. Setup only creates `.env` with fresh
cryptographic random DB/auth/admin/SpiceDB credentials, mode `0600`. It prints no
values and **refuses to overwrite an existing file**. Keep `.env` private;
`.env.example` is a documented template, not usable credentials.

Edit the generated `.env` in a local editor:

- **Set `MODEL_BASE_URL` explicitly** to a trusted OpenAI-compatible **Chat
  Completions** endpoint (normally ending in `/v1`). No old proxy is assumed. Use
  HTTPS for a remote provider, or loopback HTTP for a separately managed proxy.
  A proxy does not need to use Hermes. No model/proxy is supplied.
- Set **`CUSTOM_LLM_API_KEY` server-side only**. Inkeep's `custom/` provider reads
  this variable; it is never put in project provider options, App metadata or
  browser configuration. URLs containing credentials, query parameters or
  fragments are rejected. For an intentionally keyless **loopback** proxy only,
  explicitly set `MODEL_ALLOW_UNAUTHENTICATED_LOOPBACK=1`.
- `MODEL_ID=grok-4.6` preserves the demo selection. Your provider/proxy must offer
  that model/alias, tool calls and streaming. If deliberately selecting another
  model, change the raw `MODEL_ID`, not the `custom/` provider. The context setting
  is a configuration assumption, not proof of provider capacity.
- Use only newly dedicated database/authorization services below. Never point
  these URLs at an existing preview, shared database or production system.

The runtime always binds **`127.0.0.1:18502`**, regardless of `PORT`. Management
and DB ports must never be publicly proxied. Keep `LOG_LEVEL=warn`: released
0.80.6 logs a provider-key prefix at info level. The server/project entry points
force warn before loading Inkeep. Treat operational logs as private.

Upstream Inkeep also looks for ancestor `.env` files and `~/.inkeep/config` (the
latter can override environment values). Use an isolated checkout/account with
neither shared config nor inherited Inkeep/provider credentials. Do not modify a
shared account's configuration to make this demo run.

## 2. Dedicated databases / authorization (manual prerequisite)

Provision these **new private instances yourself**, using reviewed upstream
image versions/digests or your DB administration process. Choose releases
compatible with Inkeep 0.80.6 and record their versions locally. This repository
does not choose/pull floating DB images or alter existing containers/services.
Check that the loopback ports are free; never stop unrelated services to free them.

| Service | Loopback endpoint | Dedicated resource |
| --- | --- | --- |
| **Doltgres** management DB | `127.0.0.1:18532` | `inkeep_hydromancer_manage` |
| **PostgreSQL** runtime/auth DB | `127.0.0.1:18533` | `inkeep_hydromancer_run` |
| **SpiceDB** authorization | `127.0.0.1:18551` | Separate datastore or disposable memory store |

Use separate volumes/data directories and generated `.env` credentials. Both SQL
connections use a demo-only `hydromancer_demo` login, with independent passwords,
ownership of their respective new database and migration rights in `public`.
Names/ports above match generated URLs; update `.env` if changing them. Doltgres
is required for management versioning; ordinary PostgreSQL is **not** a drop-in
replacement for the manage DB.

On each **new dedicated instance**, through an interactive administrative SQL
session, create the demo role/database. This SQL is a template: replace password
placeholders privately with the corresponding generated URI password, not a
command saved in shell history. Use the instance's secure provisioning mechanism
if its role-creation syntax differs.

```sql
-- New management Doltgres instance only:
CREATE USER hydromancer_demo WITH LOGIN PASSWORD '<generated manage DB password>';
CREATE DATABASE inkeep_hydromancer_manage OWNER hydromancer_demo;
-- New runtime PostgreSQL instance only, in its own admin session:
CREATE USER hydromancer_demo WITH LOGIN PASSWORD '<generated run DB password>';
CREATE DATABASE inkeep_hydromancer_run OWNER hydromancer_demo;
```

Configure SpiceDB's gRPC preshared key from `SPICEDB_PRESHARED_KEY`, without exposing
it in logs, shell history or a public compose file. Match the loopback endpoint
and `SPICEDB_TLS_ENABLED=false`; plaintext is for loopback only. A memory-backed
SpiceDB is suitable only for a disposable preview. Schema/relationships disappear
on restart: repeat auth initialization before using the app again. Persistent
setups need a separate datastore and backup/recovery. Check all service readiness.

## 3. Released migrations — no skipped data migration

Copy from your locked installed package, **not** an old demo snapshot:

```sh
node scripts/prepare-migrations.mjs
```

This checks `@inkeep/agents-core` 0.80.6 and its journal, then copies the **entire
original manage directory unchanged** to ignored `.build/manage-migrations/`.
It does not access a DB and refuses to replace an existing destination. Inspect
or move an old local build yourself rather than hiding prior edits. Do not use
`drizzle-kit generate`/`push` instead of released migrations. Manage config still
uses released `manage-schema.js`; run config uses distinct `runtime-schema.js`
and runtime history. Do not replace these schemas or journal metadata.

Only after verifying both targets are your newly dedicated databases:

```sh
node --env-file=.env node_modules/drizzle-kit/bin.cjs migrate --config=drizzle.manage.config.ts
# STOP if the command above fails; do not continue initialization.
node --env-file=.env node_modules/drizzle-kit/bin.cjs migrate --config=drizzle.run.config.ts
```

After successful management migrations, inspect `dolt_status` in that dedicated
management DB and commit **that database's** migrated schema:

```sql
SELECT * FROM dolt_status;
SELECT DOLT_ADD('-A');
SELECT DOLT_COMMIT('-a', '-m', 'Initialize Inkeep 0.80.6 schema');
```

This is a Dolt **database commit**, not a repository Git commit. Do not run it
against shared data or after a failed migration.

### Known manual blocker: legacy `0015_backfill_skill_files.sql`

Some Doltgres versions panic on this released **data backfill**. The original
throwaway preview used an empty-database exception. **That workaround is not
shipped or automated here.** The preceding `skill_files` schema migration and
0015 remain intact. If 0015 fails, stop: inspect the exact DB/branch, partial state
and upstream compatibility before retrying or upgrading. Do not replace it with
`SELECT 1`, mark it applied manually, drop tables, edit the journal, or proceed
with existing skills unmigrated. A fresh install is not proof of an empty table.
There is no skip flag here; an upstream-compatible resolution is a manual
prerequisite. End-to-end bootstrap is not claimed verified in this cleanup task.

## 4. Initialize tenant/project and create a new local App

These commands **write to your dedicated services**; they are never part of the
offline setup/test command. After migrations succeed:

```sh
node --env-file=.env node_modules/@inkeep/agents-core/dist/auth/init.js
# Keep the actual API in the foreground in one terminal:
node --env-file=.env server.mjs
```

Auth init creates `TENANT_ID=hydromancer-preview`, local admin and SpiceDB schema.
No admin UI is supplied. Do not enable force-password-reset on an existing
account. Start the approved public-docs MCP separately following
`../knowledge/README.md` (loopback `18581`) and ensure the explicitly selected
model endpoint is available. In another terminal, still in `runtime/`:

```sh
node --env-file=.env project.mjs
node --env-file=.env scripts/create-local-app.mjs --create-anonymous-app
```

App creation requires the explicit flag (or equivalent `pnpm init:app`). It POSTs
to loopback management with server-only bypass authorization, then GETs **that
exact new App** to verify tenant/project/agent, enabled state, anonymous mode and
exact allowlist before saving `preview-client.json` mode `0600`. Only safe
metadata is saved. It refuses to overwrite existing metadata. If POST succeeds
but readback/disk write fails, inspect the created App with management tools
before retrying, to avoid duplicate orphan Apps. App creation calls no model.

`preview-client.example.json` shows the shape with **empty** App ID/URL; do not
copy it as working state. A new DB must issue its own App ID. Initial allowed
domains are `127.0.0.1:18580` and `localhost:18580` (Inkeep expects **host[:port]**,
not URLs). The frontend only needs App ID and agent ID, never bypass/model/DB/JWT
secrets. Follow root/frontend instructions for expiry and budgets. The optional
`authorize-preview-origin.mjs` helper changes an App allowlist for an already
selected preview origin; it is not part of local setup and creates no tunnel.
Run it only when intentionally authorizing that origin.

## 5. Explicit live verification

Default `node --test` is offline. When your own services/App are ready:

```sh
# API/auth/settings checks, no model inference:
INKEEP_LIVE_TESTS=1 node --env-file=.env --test integration.test.mjs settings.test.mjs
# Explicit potentially paid model calls:
INKEEP_LIVE_TESTS=1 INKEEP_MODEL_TESTS=1 node --env-file=.env --test chat-smoke.test.mjs verdict-live.test.mjs
```

Tests skip if opt-ins/configuration/credentials/services are missing. Model tests
preflight API health, MCP health and authenticated `GET /models`; endpoints
without `/models` skip, not pass. No inference happens unless both flags and
preflights pass. Auth/semantic/stream errors **after preflight fail tests**. Skips
are not live verification. SSE transcripts/answers stay in ignored `logs/`; never
publish them without a separate privacy review.

Offline tests cover secret permissions/non-overwrite, endpoint/credential
separation, early startup refusal, unmodified migration copying, App readback
rejection and live-test gates. Synthetic HTTP fixtures exercise contracts only;
they do not establish DB/provider compatibility. Stop only processes/dedicated
resources you started. Setup scripts never change system units, shared Docker
state, frontend expiry or budgets.
