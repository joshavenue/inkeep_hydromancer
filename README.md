# Hydromancer × Inkeep

Source code for a temporary, documentation-grounded Hydromancer chatbot: **a blank webpage with the official Inkeep chat button**, backed by a real Inkeep Agents runtime and a read-only public-documentation search service.

This repository preserves the implementation used for an exercised preview. It is **not the live Hydromancer website, a hosted service, or a production-ready deployment**. Cloning or testing it does not restart the original expired preview.

## What is included

- `frontend/`: the blank page, official widget, invitation gate, restricted reverse proxy, request limits, expiry and tests.
- `runtime/`: released Inkeep integration, agent instructions, model/tool configuration, safe setup guidance and offline/opt-in live tests.
- `knowledge/`: public-source validation, SQLite/FTS search, official MCP Streamable HTTP service, source catalog and tests.
- `cleanup.py`: optional scoped cleanup using an operator-created process-identity manifest.
- `AGENTS.md`: project instructions, including use of the TypeSafe skill.
- `THIRD_PARTY.md`: upstream software attribution and pinned widget provenance.

The Inkeep engine and chat widget are upstream software, not original project code. Application integration, retrieval and preview safeguards live around those components.

## Architecture

```text
Browser: official Inkeep chat button
    │  HTTPS + private invitation cookie + native App JWT
    ▼
Preview gateway                         127.0.0.1:18580
    │  only explicitly allowed widget routes
    ▼
Inkeep Agents API                       127.0.0.1:18502
    ├── OpenAI-compatible model endpoint (operator configured)
    ├── Public-docs MCP                  127.0.0.1:18581/mcp
    └── Dedicated Doltgres / Postgres / SpiceDB
```

The browser receives a public App ID, not an API key or management bypass secret. Database, model, MCP and management endpoints must remain private. If using a tunnel, point it at the preview gateway only.

## Setup

**Prerequisites:** a current compatible Node.js runtime (the original preview used Node24), pnpm10, Python3.11+, and dedicated database services. Model access is a separate prerequisite; an existing subscription/model relay is not bundled with this repository.

1. Follow [`knowledge/README.md`](knowledge/README.md) to prepare approved public snapshots, install the isolated Python dependencies, build the index and start the MCP service. The source catalog is not the source content itself. Fresh captures can differ from the historical preview and must be checked.
2. Follow [`runtime/README.md`](runtime/README.md) to generate local configuration, prepare dedicated databases/migrations, start the actual Inkeep runtime and initialize its project and Web Client App. Keep generated `.env` files and `preview-client.json` private.
3. Start the gateway from the repository root:

   ```sh
   node frontend/start.mjs
   ```

   It binds loopback and creates private `frontend/state.json` when absent. That file contains the invitation token, usage count and expiration. **Never publish it.** Existing expired state remains expired rather than silently extending access.
4. Arrange an HTTPS origin for the gateway. Set `publishedOrigin` in its private state and configure the exact hostname in the Inkeep App's allowed domains; `runtime/authorize-preview-origin.mjs` performs a readback-verified update for the configured temporary origin. Do not point the tunnel at the Inkeep API itself.
5. Open `https://YOUR_PREVIEW_HOST/start/INVITATION_TOKEN` using the token from your local state. The gateway exchanges it for an HttpOnly cookie and redirects to the blank page. Click **Ask AI**.

These are component-level setup instructions, not a claim of one-command deployment. The original demo required a fresh-database-specific Doltgres migration workaround; see the runtime notes before attempting migrations. Never apply an empty-database workaround to an existing application with data.

### Safety and operating limits

The gateway limits attempted chat requests, per-session turns, request size and concurrency; the runtime bounds model output and generation steps. These are demo safeguards, not a production abuse-prevention service. Keep the invitation private and review retention, authentication, monitoring and costs before public launch.

The optional CAPTCHA challenge is disabled in the shipped widget configuration because the exercised self-hosted preview did not configure Sentinel. **App JWT authentication, origin validation and the invitation gate remain required.** Do not reuse that CAPTCHA setting with an unreviewed public/hosted setup.

Only text input is supported by the gateway; file-upload requests are rejected even if the stock widget displays its upload control. No trading, wallet-signing, account-access, CRM or ticket-creation tools are connected.

### Stopping services

Use the component startup/supervisor commands to stop only your own services. `cleanup.py` is optional and requires a private `lifecycle.json` containing the exact PID/start-time identities you deliberately own, an expiry timestamp, and the three explicitly named preview containers. That machine-specific manifest is intentionally not committed. The helper verifies process identity before signalling and does not delete source files or DB volumes.

## Tests and verification

Gateway and startup tests need only Node; cleanup tests use Python and mocked processes (they do not stop real services):

```sh
node --test frontend/*.test.mjs
python3 -B -m unittest discover -s frontend -p test_cleanup.py -v
python3 -O -B -m unittest discover -s frontend -p test_cleanup.py -v
```

The optional cleanup helper itself is Linux-specific (`/proc` and Podman).

See the component READMEs for self-contained knowledge tests and runtime tests. Live API/model tests are a separate opt-in: they need running services and may consume model allowance. Skipped live tests are not proof of a working deployment.

The original preview was exercised with actual documentation retrieval and real answers in the official widget, including a copytrading question and a small two-wallet case. This repository's publication excludes the private execution logs and session data. Model answers still need domain evaluation: HTTP200, a source link, or an endpoint name alone does not establish correctness.

## Assistant behavior

- Lead with a **scoped Yes** when Hydromancer directly supports a meaningful part of the requested product; explain the supported part and the remaining work.
- Say **No** when the actual requested job is outside documented scope, such as NFT minting or direct order submission through a data API.
- Connect the user's pain to an exact documented API operation and useful inputs/fields, not generic capability claims.
- Keep native Hyperliquid limits and Hydromancer plan limits distinct and dated. Do not invent a need for a paid service when native APIs are sufficient.
- Cite public evidence; distinguish current state, historical fills, replay, execution and application correctness.
- Installing the TypeSafe skill supplies development guidance. **No TypeSafe API integration has been activated.**

## What is deliberately absent

Real credentials, OAuth tokens, private company research, chat transcripts, databases, captured API/session responses, temporary invitation links, process IDs, installed dependencies, the nested upstream checkout and machine-specific deployment state are not part of the published source.

Public documentation is retained by its publisher. The catalog records provenance; local captures and generated indexes are ignored by Git. Upstream dependency licenses and notices are described in `THIRD_PARTY.md`.
