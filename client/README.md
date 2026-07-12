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

`InlineVocabularyPickers.tsx` layers add-as-you-go controls on those pickers.
Carrier and policy-type creation is available to the three approved WCIB roles;
MGA creation is shown only for the server-derived admin role and preserves the
API's explicit near-duplicate confirmation step. Office locations remain
selection-only. All writes still pass through the guarded, audited server
endpoints; the client never writes or audits vocabulary directly.

The admin MGA Payables workspace lives under `src/mga-payables`. It renders
server-provided groups and exact stored `netDue` totals without recalculating
financial values in the browser. Mark-paid and unmark actions call only the
atomic payment-state endpoint, stay single-flight, and refresh the complete
server view after success. The client never calls pay-sheet placement directly
and does not implement the inert payment-tracking fields.
