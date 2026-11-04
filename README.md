# Hydromancer × Inkeep

A documentation-grounded assistant for hydromancer.xyz: **the official Inkeep chat
button**, backed by the released Inkeep Agents runtime, a cheap model, and a
read-only search index built from exactly three public sources:

- `docs.hydromancer.xyz`: the API and Reservoir documentation
- `hydromancer.xyz`: products, pricing, customers and blog posts
- `hyperliquid.gitbook.io`: the public Hyperliquid API documentation

The assistant answers only from text retrieved from that index and cites the page
it used. It is read-only: it explains what the Hydromancer API, Reservoir and the
Hyperliquid API offer and whether they fit what a visitor wants to build. It never
places orders, signs, or touches accounts.

## What is included

- `knowledge/`: one-command capture of the three sources, SQLite/FTS search, the
  official MCP Streamable HTTP service and tests.
- `runtime/`: released Inkeep integration, assistant prompt, model and cost
  configuration, safe setup guidance and offline/opt-in live tests.
- `frontend/`: loopback gateway with the official widget, invitation gate,
  restricted reverse proxy, request limits and tests.
- `vercel/`: public static page plus a narrow server-side bridge for the gateway.
- `cleanup.py`: optional scoped cleanup using an operator-created process-identity manifest.
- `AGENTS.md`: project instructions, including use of the TypeSafe skill.
- `THIRD_PARTY.md`: upstream software attribution and pinned widget provenance.

The Inkeep engine and chat widget are upstream software, not original project code.

## Architecture

```text
Browser: official Inkeep chat button
    │  HTTPS + native App JWT (+ private invitation cookie on the preview gateway)
    ▼
Gateway / Vercel bridge                 only explicitly allowed widget routes
    ▼
Inkeep Agents API                       127.0.0.1:18502
    ├── Model: openai/gpt-6-luna (reasoning off, 700-token answers)
    ├── Public knowledge MCP             127.0.0.1:18581/mcp  (docs + site + Hyperliquid docs)
    └── Dedicated Doltgres / Postgres / SpiceDB
```

The browser receives a public App ID, not an API key or management secret.
Database, model, MCP and management endpoints stay private.

## Cost

The model is the main running cost. With `openai/gpt-6-luna` ($0.10 per 1M input
tokens, $0.50 per 1M output), reasoning switched off and answers capped at 700
tokens, a typical question costs **about $0.001** (measured over eight typical
questions on 4 November 2026: one search each, about 10,000 input and 190 output
tokens). A thousand visitor questions is roughly $1.10. `runtime/README.md` lists
the alternatives and how to switch. Set a monthly spending cap on the provider key;
the gateway's per-session and global limits are abuse protection, not billing control.

## Setup

**Prerequisites:** Node 24, pnpm 10, Python 3.11+, an OpenAI API key, and
dedicated database services.

1. `knowledge/README.md`: create the Python environment, run `refresh.py` to
   capture all three sources and build the index, start the MCP server.
2. `runtime/README.md`: generate `.env`, set `OPENAI_API_KEY`, prepare the
   dedicated databases and migrations, start the Inkeep API, run `project.mjs` to
   push the assistant configuration, create the Web Client App.
3. Start the gateway from the repository root:

   ```sh
   node frontend/start.mjs
   ```

   It binds loopback and creates private `frontend/state.json` when absent (invitation
   token, usage count, expiry). **Never publish it.**
4. Arrange an HTTPS origin for the gateway, set `publishedOrigin` in its private state
   and add the exact hostname to the Inkeep App's allowed domains
   (`runtime/authorize-preview-origin.mjs`). For the public page, follow `vercel/README.md`.
5. Open the page and click **Ask AI**.

These are component-level instructions, not a one-command deployment. See the
runtime notes on the Doltgres migration blocker before attempting migrations.

### Embedding on hydromancer.xyz

The `vercel/` bridge shows the shape: a static page loads the pinned widget
(`embed.js`), fetches `/api/config` for the public App ID, and points the widget's
`baseUrl` at a same-origin proxy that forwards only the widget routes to the
gateway. On the real site the same `init.js` snippet can be dropped into the page
template once the proxy runs under the site's domain and that hostname is in the
App's allowed domains.

### Safety and operating limits

The gateway limits chat requests, per-session turns, request size and concurrency;
the runtime bounds model output and generation steps. Review retention,
authentication, monitoring and spend caps before public launch.

The optional CAPTCHA challenge is disabled in the shipped widget configuration
because the self-hosted preview did not configure Sentinel. **App JWT
authentication, origin validation and the gateway limits remain required.**

Only text input is supported; file-upload requests are rejected. No trading,
wallet-signing, account-access, CRM or ticket-creation tools are connected.

### Stopping services

Use the component startup/supervisor commands to stop only your own services.
`cleanup.py` is optional and requires a private `lifecycle.json` naming the exact
PID/start-time identities you own; see the file for details.

## Tests and verification

```sh
node --test frontend/*.test.mjs
node --test vercel/test/*.test.mjs
(cd runtime && node --test)
(cd knowledge && .venv/bin/python -m pytest -q)
python3 -B -m unittest discover -s frontend -p test_cleanup.py -v
```

All of these run offline. Live API/model tests are a separate opt-in in
`runtime/`; they need running services and spend model tokens. Skipped live tests
are not proof of a working deployment, and a cited URL alone does not prove an
answer is correct: review answers against the pages they cite.

## Assistant behavior

- Searches the index before any factual claim and answers only from what it
  retrieved; if the tool fails it says so instead of answering from memory.
- Cites the exact source URL next to each claim, from the three allowed hosts only.
- Leads with a **scoped Yes** when Hydromancer covers a meaningful part of the
  visitor's product, then names what remains their job (execution, keys, risk).
- Says **No** when the request is outside documented scope, such as NFT minting
  or placing orders through a data API.
- Distinguishes capability from necessity: Hyperliquid's own API may be enough for
  small workloads, and Hydromancer has plan limits too.
- Short, plain answers (under 200 words unless asked for detail), no marketing
  language, no guarantees.
- Installing the TypeSafe skill supplies development guidance. **No TypeSafe API
  integration has been activated.**

## What is deliberately absent

Real credentials, OAuth tokens, private company research, chat transcripts,
databases, captured page bodies, generated indexes, temporary invitation links,
process IDs, installed dependencies and machine-specific deployment state are not
part of the published source. Public documentation remains the content of its
publisher; the capture catalog records provenance.
