# Hydromancer assistant: handoff for putting it on hydromancer.xyz

Written 5 Nov 2026. Repo `joshavenue/inkeep_hydromancer`, branch `feat/public-site-assistant-light-model` (PR #2), head `e9b59f8`.
Test deployment: https://inkeeptest.vercel.app (Vercel bridge) → EC2 `inkeep-test` in ap-northeast-1 (Tokyo).

This document says what is running, what must change for the live site, and the exact steps. Component-level READMEs (`README.md`, `runtime/README.md`, `knowledge/README.md`, `vercel/README.md`, `deploy/`) hold the details; this page is the map.

## 1. What the visitor gets

An "Ask AI" button (official Inkeep chat widget, pinned version 0.17.8) that answers only from four public sources: docs.hydromancer.xyz, hydromancer.xyz, Hyperliquid's API docs and the founder's public Telegram profile, plus 72 one-page summaries of Hyperliquid ecosystem apps written from each app's own website. Every answer cites `[Page title](url)` links to those public pages. It has no tools other than document search: no trading, wallets, accounts, CRM or tickets.

Behaviour that is already built and tested (see `runtime/project.mjs`, the prompt):

- Build questions ("can I build a copy-trading bot?", "an app like fomo") get a yes/no fit verdict, the matching How-to-Build guide and the first endpoints.
- "Why Hydromancer / how is it different / which should I use" answers with the documented numbers (1,200-weight public budget vs 1,000-wallet batches, 10,000-fill cap vs fills since 28 Jul 2025, data the public API has no request for).
- Troubleshooting for the common errors (`error code: 1010` → User-Agent, case-sensitive types, ms vs s, cursor resync).
- Customer relationships are confidential: it never says whether a named company is a customer, what plan it has or what it pays, even when told "I work there". Public customer stories page only.
- Contact details (Xeno, Telegram, email) only when asked. The gateway appends a "speak to Xeno" footer from the 11th user message of a chat, deterministically.
- Prompt-injection and config-leak attempts refuse (tested: system prompt, env vars, file paths, fake admin).

## 2. Architecture as deployed

```text
Browser (hydromancer.xyz page)
  │  official widget: embed.js + init.js, public App ID only, App JWT per anonymous session
  ▼
Same-origin proxy  (today: Vercel functions under inkeeptest.vercel.app/api/*)
  │  forwards 8 allowlisted widget routes only; adds the gateway invitation server-side
  ▼
Gateway  node frontend/start.mjs   EC2 127.0.0.1:18580  (public via Cloudflare quick tunnel today)
  │  origin check, per-session and global limits, 96 KB body cap, answer filter, 10-exchange footer
  ▼
Inkeep Agents API  127.0.0.1:18502  (open-source Inkeep runtime, self-hosted)
  ├── Model: anthropic/claude-haiku-5-5, ANTHROPIC_EFFORT=medium (adaptive thinking, 4,000-token cap)
  ├── Knowledge MCP  127.0.0.1:18581  Python, SQLite FTS index of the four sources + ecosystem pages
  └── Postgres 18, Doltgres, SpiceDB in Docker (deploy-postgres-1, deploy-doltgres-1, deploy-spicedb-1)
```

Services are `systemd --user` units on the box (`deploy/systemd/`): `inkeep-api`, `inkeep-gateway`, `inkeep-knowledge`, `inkeep-tunnel`, and `inkeep-refresh.timer` (daily re-capture of the public pages and index rebuild). Secrets live only in `~/inkeep/runtime/.env` on the box (mode 600) and in Vercel's production environment. Nothing secret is in the repo.

## 3. What must change for the live site

The test setup has three throwaway pieces that a production site should not depend on. Everything else carries over unchanged.

| Piece | Today (test) | Live site |
| --- | --- | --- |
| Public origin of the gateway | Cloudflare **quick** tunnel; hostname changes on every restart (`deploy/tunnel-sync.sh` re-registers it) | A fixed hostname, e.g. `assistant.hydromancer.xyz`. hydromancer.xyz DNS is already on Cloudflare, so a **named Cloudflare Tunnel** (`cloudflared tunnel create`, CNAME in the zone) is the least work and keeps the box with no open inbound ports. Alternative: an ALB/Nginx with TLS in front of 18580. |
| Same-origin proxy | Vercel project `inkeep_test` (`vercel/`), 8 route wrappers | Either (a) keep a Vercel project but under `hydromancer.xyz/api/assistant/*` via Webflow/site reverse proxy, or (b) drop the proxy and let the widget call the gateway origin directly over CORS. **(b) is simpler**: the gateway already validates `Origin`; set `allowedOrigins` to `https://hydromancer.xyz` and `https://www.hydromancer.xyz`, and add a CORS preflight handler (the gateway currently has none because the proxy made every call same-origin). Then `init.js` uses `baseUrl: 'https://assistant.hydromancer.xyz'` and `fetch('.../config.json')`. |
| Invitation token | `/start/<token>` sets a `preview_session` cookie; the Vercel function redeems it server-side so visitors never see it | Remove the invitation step for the public site (it was a preview gate, not a security control: App JWT + origin + limits are the real controls). Keep per-session limits. Remove `PREVIEW_TTL_HOURS` (the gateway currently **expires on 2026-12-09**) or set it to a long value; `usedRequests` global cap (`PREVIEW_MAX_REQUESTS`, now 5,000, 529 used) should become a per-day or per-IP rate limit instead of a lifetime counter. |

Also before launch:

- **Instance size.** t3.small (2 GB) is at 1.3 GB used with 586 MB available; headroom is thin and the daily refresh plus a traffic spike could OOM. Move to t3.medium (4 GB) or larger. The owner has AWS credit for this.
- **Spend cap.** Set a monthly limit on the Anthropic key. Measured cost: a question is roughly 10,000 input and 200 to 700 output tokens on Haiku 5.5 ($0.10 / $0.50 per 1M), so about $0.001 to $0.002 each; 10,000 visitor questions ≈ $15. The gateway limits are abuse protection, not billing control.
- **CAPTCHA.** `shouldBypassCaptcha: true` in `init.js` because Sentinel is not configured on the self-hosted runtime. Fine for launch given App JWT and limits; revisit if bots show up.
- **Model and effort.** Keep `MODEL=anthropic/claude-haiku-5-5`, `ANTHROPIC_EFFORT=medium`. Measured medians: no thinking 4.4 s, medium about 6 to 9 s, high 9.8 s. Unset `ANTHROPIC_EFFORT` to get the fastest answers.
- **Backups.** Postgres holds every conversation (see §6). Snapshot the EBS volume or `pg_dump` the `inkeep_hydromancer_run` database on a schedule.
- **Logs.** `~/inkeep/runtime/logs/` and `journalctl --user -u inkeep-*`. Nothing ships off-box today.

## 4. Steps

Secrets are referred to by name only. Never paste them into chat, tickets or the repo.

1. **Clone and read.** `git clone` the repo at `feat/public-site-assistant-light-model` (or `main` after PR #2 merges). Read `README.md` §Setup and `runtime/README.md`. Run the test suites once on your machine: `cd knowledge && .venv/bin/python -m pytest -q` (80 pass), `cd runtime && node --test` (23), `cd frontend && node --test` (49), `cd vercel && node --test` (22).
2. **Provision.** New EC2 (t3.medium, Ubuntu 24.04+, Tokyo keeps latency to Hyperliquid data low; Node 24, pnpm 10, Python 3.11+, Docker). Or resize the existing `inkeep-test` instance in place; everything on it is in the repo except `runtime/.env`, `frontend/state.json`, `runtime/preview-client.json` and the databases.
3. **Runtime.** Follow `runtime/README.md`: generate `.env` from `.env.example`, set `ANTHROPIC_API_KEY`, `MODEL`, `ANTHROPIC_EFFORT`, the two database URLs, `BETTER_AUTH_SECRET`, `INKEEP_AGENTS_JWT_SIGNING_SECRET`, `INKEEP_AGENTS_MANAGE_API_BYPASS_SECRET`, SpiceDB values. Start Docker services, run migrations (note the Doltgres migration caveat in that README), start `inkeep-api`, run `node --env-file=.env project.mjs` to push the assistant configuration, create the Web Client App (`app_…` id; the test one is `app_aw9q6kzxn3goc8xeyqkxs`).
4. **Knowledge.** `knowledge/README.md`: create `.venv`, `python refresh.py` (captures the four sources, ~10 min with the 0.25 s delay), confirm `curl :18581/health` shows `provider_counts` with hydromancer 226, native 82, site 68, telegram 1, ecosystem 72 (numbers drift as pages are added). Install `inkeep-refresh.timer` so the index follows the docs daily. The ecosystem pages come from `knowledge/ecosystem-apps.json` via `build_ecosystem.py`; they are not captured from the web.
5. **Gateway.** Install `inkeep-gateway.service`. Set `allowedOrigins` to the production site origins and add the CORS preflight (or keep the proxy, see §3). Remove or extend the preview TTL and lifetime cap.
6. **Public hostname.** Create the named Cloudflare Tunnel to `http://127.0.0.1:18580`, CNAME `assistant.hydromancer.xyz` to it. Add that hostname **and** `hydromancer.xyz` / `www.hydromancer.xyz` to the Inkeep App's `allowedDomains` with `allowAnonymous: true` (`runtime/authorize-preview-origin.mjs` shows the exact PATCH; adapt the hostname assertion).
7. **Widget on the site.** Serve `embed.js` (built by `vercel/scripts/build.mjs`, SHA-256 verified, MIT notice in `widget-LICENSE`) and `init.js` from the site or the gateway. `init.js` is the whole integration: App ID, `baseUrl`, assistant name, placeholder, four example questions, disclaimer, the single "Speak to the founder" button (https://t.me/xenoflux). In Webflow this is one `<script type="module" src=".../init.js">` in the site-wide footer code. Keep `shouldOpenLinksInNewTab: true`.
8. **Verify.** From the live page: open the widget, ask "What does the Starter plan include?" and "How is Hydromancer different from the Hyperliquid API?". Then from a shell run the batteries against the new origin: `deploy/qa-ask.py` with `deploy/qa-questions.txt`, `qa-tone.txt`, `qa-contact.txt`, `qa-ecosystem.txt`, `qa-why.txt` (they need the gateway URL and app id; see the script header). Check: no empty answers, no `.md` or `llms.txt` citation URLs, no contact line on questions that did not ask for one, refusals on the "which plan is X on" questions.
9. **Decommission the test pieces** once live: Vercel project `inkeep_test`, the quick-tunnel service, the preview invitation.

## 5. Updating content and behaviour later

- **Docs or site changed:** nothing to do; the daily `inkeep-refresh.timer` re-captures and rebuilds. To force it: `systemctl --user start inkeep-refresh.service`.
- **Prompt change:** edit `runtime/project.mjs`, run `node --test` in `runtime/` (a test caps prompt length; tighten wording before raising the cap), then on the box `git pull && cd runtime && node --env-file=.env project.mjs`. No restart needed.
- **Retrieval tuning** (which pages win for which question): `knowledge/knowledge.py` `query_plan()` aliases and boosts; `pytest`, then `systemctl --user restart inkeep-knowledge.service`.
- **New ecosystem app:** add an entry to `knowledge/ecosystem-apps.json` (public facts only, cited to the app's site), run `build_ecosystem.py ecosystem-apps.json`, rebuild the index, restart knowledge. The builder refuses pages containing business terms (plan names, "peering", "churn", "trial key").
- **Widget text or buttons:** `init.js` only; redeploy the static file.
- **Model:** `MODEL` and `ANTHROPIC_EFFORT` in `runtime/.env`, `systemctl --user restart inkeep-api.service`.

## 6. Conversation logs

Every chat is stored by the Inkeep runtime in Postgres (`inkeep_hydromancer_run`, tables `conversations` and `messages`; `role` user/agent, `visibility = 'user-facing'` for what the visitor saw). Visitors are anonymous ids; they may paste wallet addresses or keys, so treat the data as sensitive and keep it on the box.

Export used on 5 Nov (adapt the container name):

```sh
docker exec deploy-postgres-1 psql -U hydromancer_demo -d inkeep_hydromancer_run -At -F $'\t' \
  -c "select conversation_id, created_at, role, content->>'text' from messages
      where visibility='user-facing' order by conversation_id, created_at" > convo-export.tsv
```

Widget conversations have ids starting `conv_`; everything else was QA traffic from `deploy/qa-*.py`. The owner wants logs kept indefinitely. Inkeep's open-source Manage UI (`@inkeep/agents-manage-ui`, Traces view) can be added later for a clickable timeline; it is a separate Next.js app and wants more RAM.

## 7. Known gaps and open items

- No CORS preflight in the gateway yet (not needed while the Vercel proxy made calls same-origin). Required for option (b) in §3.
- Preview gateway expires 2026-12-09 unless `PREVIEW_TTL_HOURS` is changed; the lifetime request cap is a preview artefact.
- Two pages disagree on the uptime SLA (why-hydromancer says 99.99%, pricing docs say 99.9%); the bot cites whichever it retrieves. Fix on the site, the index follows.
- Testnet: Hydromancer's testnet endpoints are not documented per endpoint; the bot knows the base URLs and plan rows only. See `~/Desktop/Hydromancer SEO/testnet-coverage-audit-2026-11-05.md` on the owner's machine.
- Google indexing of the test page is blocked (`X-Robots-Tag: noindex`) on purpose; the live site should not inherit those headers for the main pages, only for the gateway responses.

## 8. Contacts

Owner: Josh (`joshzensite@gmail.com`, GitHub `joshavenue`). Product and plan questions: Xeno, https://t.me/xenoflux. Nothing in this document, the repo or the logs should go to Inkeep's hosted service; the stack is fully self-hosted.
