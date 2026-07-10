# WCIB Dashboard — Data Model & Schema
**Companion to `wcib_dashboard_v11.html`. For the engineer porting the prototype to a real multi-user backend.**
**Generated:** June 23, 2026

> **⚠ STATUS vs the current build (`wcib_dashboard_v15.html`, July 2026):** This schema was written against v11 and is still accurate for the core (staff, policies, drafts, pay sheets, vocabularies, KPIs). Two deltas: **(1) The Budget is no longer in the app** — the `wcib_v9_budgets` key and entity #5 (Budget month + recurring template) were removed from v15; that function moved to a private Excel workbook. **Do not build a budget module** unless the client re-requests it. **(2)** A new **payment-tracking / open-balance** feature is being specced separately (`WCIB_Payment_Tracking_Spec.md`) and will add fields to the Policy entity — it is NOT final yet. Everything else below stands.

---

## How the prototype stores data today (and what changes)

Everything currently lives in the **browser's localStorage on a single computer**, under ten keys (all namespaced `wcib_v9_`). There is **no server, no shared database, and no real authentication** — "login" is just a role button. The port replaces localStorage with a hosted Postgres database (e.g. Supabase) so every teammate shares one source of truth, and adds real accounts.

| localStorage key | Holds | Becomes (suggested table) |
|---|---|---|
| `wcib_v9_staff` | People, roles, producer rate history | `staff`, `producer_rate_history` |
| `wcib_v9_ledger` | Approved policies (Check Turn-Ins) | `policies` |
| `wcib_v9_queue` | Policies awaiting admin approval | `policies` w/ `status`, or a `queue` view |
| `wcib_v9_drafts` | Per-user work-in-progress turn-ins | `drafts` |
| `wcib_v9_paysheets` | Monthly pay sheets + snapshots | `pay_sheets`, `pay_sheet_policies` |
| `wcib_v9_budgets` | Budget months + recurring template | `budget_months`, `budget_lines`, `budget_template` |
| `wcib_v9_mga` | Controlled MGA vocabulary | `mgas` |
| `wcib_v9_poltypes` | Policy-type list + line-of-business class | `policy_types` |
| `wcib_v9_insco` | Insurance-carrier list | `carriers` |
| `wcib_v9_kpitargets` | KPI goal targets per scope/year | `kpi_targets` |

A note on identity: the prototype keys per-user data off `currentUserId`, which is just **the person's name lowercased**. In production this must become a **real user ID** (uuid) with a login + password, and every record below that references a person should reference that ID, not the name string.

---

## Entities

### 1. Staff (person / user account)
The roster of everyone who can log in. Seeded with Kaylee (the one producer) and Mercedes, Daniela, Joseph, Ellyscia as employees. **Sophia is the owner/admin** — she logs in via the separate hardcoded "Admin" button (not a staff row) and is also the fixed internal label for the agency/house pay sheet. (Roles are editable in-app via Manage Staff; this is just the fresh-install seed.)

| Field | Type | Notes |
|---|---|---|
| `name` | string | Currently doubles as the identity key — **add a real `id` (uuid) in production** |
| `role` | `'employee' \| 'producer'` | Plus an **admin** capability (today Sophia simply logs in via the admin button) — see Permissions Matrix |
| `gender` | `'female' \| 'male' \| other` | Drives his/her/their pronoun labels |
| `rates` | `{ history: RateEntry[] }` | Producers only; **append-only** |
| *(new)* `password_hash` | string | **Does not exist yet** — core production add |
| *(new)* `email` / `active` | string / bool | For login + deactivating someone without deleting history |

**RateEntry** (one row per rate change, newest wins by date):
`{ effectiveDate, newComm, newBroker, renewalComm, renewalBroker }` — all percentages.
Rule: rate history is **never deleted** (single exception: a producer with only one entry can't delete it). Pay sheets snapshot the rate in effect on the day they close.

---

### 2. Policy (a Check Turn-In)
The central record. Starts as a **draft**, becomes a **queue** entry on submit, becomes a **ledger** (approved) policy on approval. Admins' submissions skip the queue.

| Field | Type | Notes |
|---|---|---|
| `id` | string (`pol-…`) | |
| `submittedBy` / `submittedById` | string | Who entered it (always shown — used for coaching) |
| `insured`, `company`, `polnum` | string | Insured party + policy number |
| `poltype` | string | From the controlled `policy_types` list (has a P/C/L class) |
| `txntype` | string | New / Renewal / Rewrite / Endorsement / Audit / Cross-sale |
| `txnNotes`, `notes` | string | |
| `effdate`, `expdate` | date | |
| `insco` | string | Carrier — from `carriers` list |
| `mga` | string | MGA payable-to — from controlled `mgas` list |
| `agent` | string | Account assignment context |
| `base`, `taxes`, `mgaFee`, `carrierFee`, `brokerFee`, `commission` | number | Money fields |
| `commMode`, `commRate` | string / number | How commission was computed (pct / tbd / …) |
| `amtPaid`, `proposalTotal`, `netDue`, `payMode`, `financeBalance` | number / string | Payment math |
| `producer` | string | Assigned producer's name (`''` = Sophia/house) → **FK to staff** |
| `kaylee` | `'none' \| 'book' \| 'house'` | Split flag — `≠ 'none'` means the producer earns 25% |
| `overridden`, `overrideReason`, `overrideOriginal` | bool / string / object | Override **always requires a written reason**; original values kept permanently |
| `approvedAt`, `paidAt` | datetime | |
| `mgaPaid`, `mgaPayRef` | bool / string | MGA settlement status + confirmation ref |
| `onPaySheets` | string[] | Which pay sheet(s) this policy landed on |
| `status` *(queue)* | `'pending' \| 'sent-back' \| 'flagged'` | Plus `sentBackReason`, `sentBackBy`, `sentBackAt` |

---

### 3. Draft
Per-user, work-in-progress turn-ins. Capped at 20 per user in the prototype.

`{ id, ownerId, ownerName, schemaVersion, status: 'draft'|'flagged'|'sent-back', …all the policy form fields…, history: HistoryEntry[], sentBackReason, sentBackBy, sentBackAt }`
**HistoryEntry:** `{ at, by, action, note }` — an audit trail of edits/sends-back.

---

### 4. Pay Sheet
One per person per month. Sophia always has one; producers get one once they have an MGA-paid policy.

| Field | Type | Notes |
|---|---|---|
| `id` | string (`ps-…`) | |
| `ownerName` | string | → FK to staff |
| `ownerType` | `'sophia' \| 'producer'` | |
| `month`, `year` | string / number | The period |
| `status` | `'open' \| 'closed'` | |
| `closedAt`, `closedBy` | datetime / string | |
| `policyIds` | string[] | → policies on this sheet |
| `rateSnapshot` | RateEntry \| null | Frozen producer rate at close |
| `totals` | object \| null | `{ brokerFeeTotal, commissionTotal, grandTotal, payout, sophiaShareTotal }` — frozen at close |
| `policySnapshot` | object[] \| null | **Self-contained** per-policy copy written at close so KPIs/history never depend on the live ledger |

Rules: closing a sheet **freezes its totals and auto-opens the next month** for that person (December → next January). A settled policy lives on **exactly one** (closed) sheet and must never re-appear on a later open sheet. Sophia's grand total = **agency gross brokerage revenue** (full amounts, not her 75%); a footer line shows her actual take-home.

---

### 5. Budget month + recurring template
`budgets` is keyed by `periodKey = "{year}-{monthIndex}"`.

**Budget month:** `{ month, year, status: 'open'|'closed'(archived), manualIncome?, categories: { hard, cc, emp, payables, misc, inter } }`
Each category is an array of **budget lines**:
`{ id, name, budgeted, actual, paid, notes, recurring, resolved, createdInKey, autoTax }`

- **Six categories:** Hard Bills · Credit Cards · Employees · Business Payables · Business Monthly Subscriptions · Intertwined.
- **`budget_template`** is the recurring set of lines that prefills each new month's *Budgeted* column. Actuals + Paid reset each month. Should be **append-friendly** server-side.
- **Income is not stored on the budget** — it's pulled live from Sophia's pay sheet for that same month/year, and **locks** to the sheet's `grandTotal` the moment that sheet closes. Historical months (pre-pay-sheet, e.g. May 2026) carry a frozen `manualIncome` instead.
- **Hard Bills → Taxes** is an auto-reserve = 30% of gross income (computed, read-only budgeted; actual stays editable).

---

### 6. Controlled vocabularies
- **`mgas`** — MGA names. **Admin-only** to add; a 75%-similarity check blocks near-duplicates; an MGA in active use can't be removed.
- **`policy_types`** — ~123 types, each tagged class **Personal / Commercial / Life-Health**. Anyone may add (prompts for class).
- **`carriers`** — ~160 insurance companies. Anyone may add.

### 7. KPI targets
`kpi_targets` keyed by scope (company or producer) + year: editable goals for **new-policy count, new revenue, retention rate**.

---

## Relationships (quick map)

```
staff (1) ───< producer_rate_history
staff (1) ───< policies            (submittedById, producer)
policies (M) >─── pay_sheets        (pay_sheet.policyIds)
pay_sheets (sophia, month/year) ──→ feeds budget income (locks on close)
drafts ──→ queue entry ──→ ledger policy   (lifecycle of one turn-in)
policies.mga ──→ mgas
policies.poltype ──→ policy_types
policies.insco ──→ carriers
budget_months (1) ───< budget_lines ; budget_template ──→ prefills new months
```

## Things that MUST move from "UI-only" to "server-enforced"
These are correctness/financial rules currently enforced only in the browser. In a multi-user app they must be enforced in the database/API or they can be bypassed:
1. **Employees never see financials** (commission, net-due, splits, revenue). *Highest priority.*
2. **Override requires a written reason**; originals preserved.
3. **MGA add is admin-only**; controlled vocab; no removing an in-use MGA.
4. **Producer rate history is append-only.**
5. **A closed pay sheet / archived budget month is immutable.**
6. **Closed-month budget income is frozen** and never moved by later months.
