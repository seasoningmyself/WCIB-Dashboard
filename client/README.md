# WCIB frontend

The React entry point is `src/main.tsx`. Run `npm run dev:client` from the
repository root to start Vite.

Client API requests default to the same-origin `/api` path. During local
development, Vite proxies that path to `http://127.0.0.1:5000`; override the
proxy with `WCIB_API_PROXY_TARGET`. A future deployment may set
`VITE_API_BASE_URL` to an absolute HTTP(S) URL or a root-relative path. Never
place secrets in `VITE_` variables because Vite exposes them to the browser.
