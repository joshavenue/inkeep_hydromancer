# Third-party software

This repository contains integration code for Inkeep, not a fork or reimplementation of its agent platform.

## Inkeep runtime

`runtime/package.json` and its lockfile pin the Inkeep API, core and SDK packages. Their upstream license and supplemental terms apply to those dependencies; this repository does not relicense them.

- Source: https://github.com/inkeep/agents
- License: https://github.com/inkeep/agents/blob/main/LICENSE.md
- Supplemental terms: https://github.com/inkeep/agents/blob/main/SUPPLEMENTAL_TERMS.md

## Official browser widget

`frontend/public/embed.js` is the **unmodified** `dist/embed.js` from `@inkeep/agents-ui-js-cloud@0.17.8`. It is vendor code, not original project code. The package-supplied license is preserved at `frontend/widget-LICENSE` (the supplied notice identifies Chakra UI). Bundled third-party notices remain in the JavaScript.

- Package: https://www.npmjs.com/package/@inkeep/agents-ui-js-cloud/v/0.17.8
- npm archive integrity: `sha512-+7pF0CRFBp3bID+mzvanHmisesJiQDYgofm7sjZMK2I0CrNqZKjHNn+8WexEEP+UssNwh8m3KFcgZy9HRoDnug==`
- `embed.js` SHA-256: `8c75de39e4d2d82d4e0307bc82cf73bf252f5c9489a7794674811a9ac2307366`

The runtime and Python dependencies retain their own licenses. Public documentation remains the content of its respective publisher; the source catalog provides provenance, not a grant to relicense those documents.
