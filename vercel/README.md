# Public Vercel bridge for the temporary Inkeep preview

A static copy of the existing Hydromancer screenshot page plus a narrowly scoped server-side proxy. No framework, runtime dependencies, TypeSafe API integration, Inkeep management API, or backend deployment is added.

```text
Browser → https://inkeeptest.vercel.app
          static public/ + /api/config + allowlisted /api/run/…
        → fixed HTTPS invitation gateway (server-side only)
        → existing private Inkeep runtime
```

## Deployment boundary

The intended existing Vercel project is `inkeep_test`, with production origin **`https://inkeeptest.vercel.app`**. Use the repository's **`vercel` root directory**, Node **24.x**, and Fluid compute. `vercel.json` explicitly sets `framework: null`, output `public`, the build/install commands, request cancellation, and a **300-second** function duration. This overrides an inherited framework/build preset; this is not a Node server/Next.js project.

**The backend remains temporary.** This bridge does not restart it, extend its existing expiry, reset its existing 40-request global cap, change per-session turns/rate limits/concurrency, or bypass native App JWT checks. Gateway 410/429 responses remain failures. Public visitors share the remaining global allowance. Clearing a cookie creates another session, not a fresh global budget. Session loss after a gateway restart can be renewed only through `/api/config`; ordinary run requests are never automatically retried.

This source change does **not** configure Vercel access/project settings or deploy anything. The operator must review/publish the Git artifact, keep secrets production-only, and separately ensure the production URL is accessible without Vercel login. Preview aliases with a different origin are intentionally not authorized for POSTs. Do not expose management, databases, or the underlying Inkeep API. A public bootstrap route is not bot protection: non-browser callers can consume sessions/allowance; the unchanged backend cap is the final spend boundary. Noindex is not access control.

## Server-only environment

Configure these four variables in Vercel's **production** environment, never in `public/`, build arguments, source, logs, or client-prefixed environment variables:

| Name | Meaning |
| --- | --- |
| `PREVIEW_UPSTREAM_ROOT` | Fixed HTTPS origin of the **existing invitation gateway's public tunnel**, not the private Inkeep API; no path, query, credentials or fragment. |
| `PREVIEW_INVITE_TOKEN` | Sensitive existing invitation token, entered only into server-side secret configuration. No lifecycle extension. |
| `PUBLIC_ORIGIN` | Exactly `https://inkeeptest.vercel.app`, without a trailing slash. |
| `APP_ID` | Existing public `app_…` identifier. Must match gateway config, path/header/query checks. |

The static build reads none of these variables. The function fails closed with a generic 503 if configuration is invalid. Origin hostname checks reject literal IP/local targets but do not replace operator control of DNS/tunnel configuration.

## Public artifacts / build

`public/index.html` copies the existing screenshot page. Only the official widget is interactive. `public/init.js` fetches `/api/config` with same-origin credentials, then uses `window.location.origin + '/api'` as the widget base URL. The existing CAPTCHA-bypass demo setting is preserved; native browser App authentication is still required.

The approved static screenshot is included at `public/hydromancer-home.webp`. Build the pinned widget alongside it:

```sh
# From the repository root:
npm --prefix vercel run build
```

The build fails clearly if the screenshot is absent/not WebP. It downloads **only** `@inkeep/agents-ui-js-cloud@0.17.8/dist/embed.js` from the versioned jsDelivr npm URL, rejects redirects/failures, verifies SHA-256, and writes the ignored generated `public/embed.js`. No dependency upgrade or bundled vendor commit is needed. Download-only verification (without the screenshot) is available as:

```sh
node vercel/scripts/build.mjs --widget-only
```

Widget provenance matches the repository's `THIRD_PARTY.md`:

- [Official npm package 0.17.8](https://www.npmjs.com/package/@inkeep/agents-ui-js-cloud/v/0.17.8)
- SHA-256: `8c75de39e4d2d82d4e0307bc82cf73bf252f5c9489a7794674811a9ac2307366`
- npm archive integrity: `sha512-+7pF0CRFBp3bID+mzvanHmisesJiQDYgofm7sjZMK2I0CrNqZKjHNn+8WexEEP+UssNwh8m3KFcgZy9HRoDnug==`
- The package-supplied MIT/Chakra UI notice is preserved in `public/widget-LICENSE`; bundled third-party notices remain unmodified.

## Routing and security contract

There are **eight explicit Node Web Request/Response function wrappers**, all importing `lib/vercel-entry.mjs`, with no rewrite or assumed Next.js catchall support:

| Public route | Method | Gateway target / permitted query |
| --- | --- | --- |
| `/api/config` | GET | Server-only `/start/<invitation>` if needed, then `/config.json`; no caller query forwarded |
| `/api/run/api/chat` | POST | `/run/api/chat`; no query |
| `/api/run/auth/apps/[appId]/anonymous-session` | POST | Exact configured app path; no query |
| `/api/run/auth/challenge` | GET | `appId` must occur once and match |
| `/api/run/v1/conversations` | GET | Optional single `page` (1–10000), `limit` (1–100) |
| `/api/run/v1/conversations/[conversationId]` | GET | ID `[A-Za-z0-9_-]{1,160}`; no query |
| `/api/run/v1/events` | POST | No query |
| `/api/run/v1/feedback` | POST | No query |

The pure `createPreviewProxy` handler in `lib/preview-proxy.mjs` owns all access decisions:

- Every cold visitor redeems a **separate** invitation session. No server-global cookie cache exists. Only a single strictly formed 64-lowercase-hex `preview_session` is reused. Ambiguous/malformed cookies never authorize run requests.
- The invitation response must be 303 with `Location: /`, exactly one valid session cookie, and a positive, unambiguous Max-Age. It is never followed. The bridge rebuilds a host-only `Secure; HttpOnly; SameSite=Strict; Path=/` cookie and derives a conservative deadline; time spent fetching config is subtracted. The invitation token never goes to the browser. Config returns only the matching public app ID.
- A stale existing cookie can trigger **one** replacement on config's 401/403. New sessions are not retried. `/api/run/…` without a session returns 403 without any upstream call.
- POSTs require the exact configured browser Origin; GETs accept that Origin or its absence. Present `Sec-Fetch-Site` must be `same-origin` or `none`. No wildcard CORS or preflight access is provided. Upstream Origin is always the fixed gateway origin, retaining the gateway's own checks.
- Protected widget routes require the matching `x-inkeep-app-id` and a native authorization header (`Bearer`/`AppJWT`); Inkeep still verifies the JWT. Anonymous-session/challenge bootstrap routes may omit those headers, but a supplied mismatching app ID is rejected.
- Only authorization, content-type, app ID, ALTCHA, the one session cookie, and the fixed Origin reach the gateway. Other cookies, host/forwarding headers, arbitrary credentials/queries and client-chosen targets are dropped. Unknown/method-mismatched routes, including `/api/manage` and invitation routes, return 404.
- POST bodies are bounded to **96,000 bytes**, including chunked/multibyte input. Gateway payload validation remains authoritative. Config responses are bounded to 8 KiB.
- Successful responses retain status and only content-type / Inkeep conversation ID / Vercel AI stream headers. SSE bytes pass through a native ReadableStream with backpressure, not a fully buffered chat. Native anonymous-session JWT response bodies are deliberately client-visible. Errors are generic, 3xx/5xx become 502, 4xx statuses are retained, and neither upstream cookies nor error bodies are reflected.
- Fetches use manual redirect handling and a 190-second overall deadline. Client abort/cancel propagates upstream; pre-response aborts return 499/504. Once streaming starts, failures terminate with a generic stream error rather than leaking exceptions or pretending completion. Vercel cancellation can terminate the function immediately. Disconnecting cannot undo budget already charged by the unchanged gateway.
- `vercel.json` adds no-store, noindex, CSP, nosniff, no-referrer and frame denial for the static site as well.

## Tests and verification

```sh
npm --prefix vercel test
# Equivalent from repository root:
node --test vercel/test/*.test.mjs
```

No installation, real credentials, live tunnel, model calls, or deployment is required. Tests use synthetic fixtures. Coverage includes invitation redemption/reuse/renewal and failures; session isolation; Origin/cookie/App boundaries; route and query/header filtering; POST size; timeout/abort/cancel; unchanged incremental SSE; generic errors; pinned build integrity; wrapper imports, page initialization and deployment configuration. A local ephemeral HTTP fixture additionally exercises real native fetch, manual redirects, two concurrent cold visitors, reuse, and streaming before EOF. It does not start/restart the actual backend.

Implementation followed a cold-config RED→GREEN tracer, then incremental session, streaming, access-boundary, route, body, cancellation and deployment/build slices. Keep future proxy changes covered by a failing behavioral test before changing the implementation. Explicit wrappers avoid platform-specific catchall ambiguity; pinned downloads avoid vendor drift.

These are local/code-level checks, **not** proof of a deployed working assistant. After the operator deploys the reviewed artifact, it must verify no-login production access, separate browser sessions, an actual answer/SSE/citations, history, failure handling, and unchanged backend expiry/budget. Do not spend the existing allowance on automated live tests without approval.

Official platform references refreshed during implementation:

- [Node functions / Web Standard export](https://vercel.com/docs/functions/runtimes/node-js)
- [Web handlers, streaming Response and opt-in request cancellation](https://vercel.com/docs/functions/functions-api-reference)
- [Function duration / Fluid Hobby 300-second limit](https://vercel.com/docs/functions/configuring-functions/duration)
- [Vercel clarification: bare-function dynamic segments versus Next.js catchalls](https://github.com/vercel/community/discussions/947)
