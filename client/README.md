# WCIB frontend

The React entry point is `src/main.tsx`. Run `npm run dev:client` from the
repository root to start Vite.

Client API requests default to the same-origin `/api` path. During local
development, Vite proxies that path to `http://127.0.0.1:5000`; override the
proxy with `WCIB_API_PROXY_TARGET`. A future deployment may set
`VITE_API_BASE_URL` to an absolute HTTP(S) URL or a root-relative path. Never
place secrets in `VITE_` variables because Vite exposes them to the browser.

Reusable UUID-backed carrier, policy-type, MGA, and office controls live under
`src/vocabulary`. Mount `VocabularyProvider` around the form surface, then use
the narrow picker adapters from `pickers.tsx`. They load only active options
from `GET /api/vocabulary`, keep the response in memory, and clear it through
the authenticated session boundary. Typed text is never submitted as identity;
forms receive only a selected UUID.
