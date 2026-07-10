# WCIB — Engineer Handoff (START HERE)
**Prepared for the engineer building the production app · July 7, 2026**

## What this is
A working, single-file **prototype** of West Coast Insurance Brokers' internal agency dashboard (Check Turn-Ins → approvals → policy ledger → MGA payables → monthly pay sheets → KPIs). It runs entirely in the browser with **no server and no real authentication** — "login" is just a role button, and all data lives in that browser's `localStorage`. Your job is to build this into a real, secure, multi-user web app (hosted DB + real accounts). The prototype is the **functional + visual spec**; these docs explain the rules behind it.

## The source of truth
**`wcib_dashboard_v15.html`** — the current build. Open it in a browser, click **Admin — Sophia** to see everything. (Older `v11–v14` files in the project are history; ignore them.) When there's no saved data, it boots blank — that's the clean slate to build from.

## Read these, in order
1. **`WCIB_Data_Model.md`** — every entity, field, and relationship; the localStorage→Postgres mapping; and the rules that must move from UI-only to server-enforced. *(Written against v11; see its status banner for what changed in v15.)*
2. **`WCIB_Permissions_Matrix.md`** — who can see/do what, per role and per **field**. This is the security-critical piece: in production, every "✗" must be enforced on the **server**, not just hidden in the UI. *(Also has a v15 status banner.)*
3. **`WCIB_Payment_Tracking_Spec.md`** — a NEW feature (split/delayed insured payments, audit remittances, open-balance tracking). **⚠ Still being finalized with the client — see "Status" below.**
4. **`WCIB_Decisions_Log.md`** — the running record of non-obvious decisions and rationale. Reference material; useful when a design choice looks surprising.

## Current status & what's changed since the June-23 docs
- **Budget is OUT of the app.** The old in-app Budget / Operating View / History were removed from v15 — that function now lives in a separate Excel workbook the client keeps privately. **Do not build a budget module.** (The Data Model still lists budget tables from v11; ignore those for now.)
- **Settings** is trimmed to **Office locations** + **Back up & restore**. Single office today (the turn-in "office location" field stays hidden until a second is added).
- **Roster:** Kaylee = producer; Mercedes, Daniela, Joseph, Ellyscia = employees; **Sophia = owner/admin** (hardcoded admin button, not a staff row; also the fixed internal label for the agency/house pay sheet).
- **Manage Staff** now supports add / **edit (name + role)** / remove, plus producer rate history.
- **Pay Sheet** has an **Export to Excel** as well as print-to-PDF.
- **Earl / credit-card accountability** (mentioned in the Permissions doc) is **not built in v15** — treat as future scope.

## ⚠ What is NOT ready to build yet — the financing / open-balance piece
`WCIB_Payment_Tracking_Spec.md` describes split/delayed insured payments and audit remittances (tracking what the insured still owes us and what we still owe the MGA, with a partially-paid status, due-date alerts, and an open-balances report). **This spec has open questions the client is still answering.** You can and should build the **skeleton** — the rest of the app, schema, auth, and permissions — now. **Leave the payment-tracking/financing module as a stub** (or a clearly-flagged draft) until the client sends the finalized decisions. Sophia will provide updated spec answers as soon as they're settled; expect a revised `WCIB_Payment_Tracking_Spec.md`.

## The one rule to get right above all
**Employees never see financials** — commission amounts, net-due-to-MGA, splits, agency revenue. Producers see only their own numbers. This is currently enforced only by what the screen draws; in production it must be enforced server-side (row- and column-level). See the Permissions Matrix.
