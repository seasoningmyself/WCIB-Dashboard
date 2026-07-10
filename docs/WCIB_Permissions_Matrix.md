# WCIB Dashboard — Permissions Matrix
**Companion to `wcib_dashboard_v11.html`. The security-critical spec — who can see and do what.**
**Generated:** June 23, 2026

> **⚠ STATUS vs the current build (`wcib_dashboard_v15.html`, July 2026):** The role model and the field-level visibility rules below are current and correct — enforce them server-side. Two rows are now out of scope for v15: **Budget** and **Month History** (the budget was removed from the app), and the **Earl / Credit-Card Accountability** area (never built — treat as future scope; the open decision at the bottom is unresolved). Current roster: Kaylee = producer; Mercedes, Daniela, Joseph, Ellyscia = employees; Sophia = admin.

---

## Why this document exists
In the prototype, all of these rules are enforced **only by what the screen draws** — an employee simply isn't shown a tab. In a real multi-user website that is **not security**: anyone who can reach the server could request the hidden data directly. Every "✗" in the tables below must be enforced on the **server / database**, not just hidden in the layout. This is the single most important thing for the engineer to get right, because the app handles payroll, commissions, and credit-card data.

---

## Roles

| Role | Who | One-line summary |
|---|---|---|
| **Admin (Sophia)** | Owner | Full access to everything, including all financials. |
| **Producer** | Kaylee | Same data-entry as employees, **plus their own commission pay sheet**. Sees their own numbers only — never anyone else's, never agency-wide financials. |
| **Employee** | Mercedes, Daniela, Joseph, Ellyscia | Data entry only (Create Check Turn-In + their own drafts). **No financials at all.** |
| **Earl** *(new, this build)* | Earl | TBD by the credit-card build — likely an employee who additionally sees/edits the **credit-card accountability** area only. See note at bottom. |

> The hard rule, verbatim from the Decisions Log: **"Employees never see financials — Net due to MGA, commission amounts, splits, agency revenue — none visible to employees."**

---

## Tab / area access

| Area | Admin | Producer | Employee |
|---|:--:|:--:|:--:|
| Create Check Turn-In (form) | ✓ | ✓ | ✓ |
| My Drafts (own only) | ✓ | ✓ (own) | ✓ (own) |
| Approvals queue | ✓ | ✗ | ✗ |
| Policy Ledger | ✓ | ✗ | ✗ |
| MGA Payables | ✓ | ✗ | ✗ |
| Pay Sheets — **all** | ✓ | ✗ | ✗ |
| Pay Sheet — **their own** | ✓ | ✓ (own) | ✗ |
| Budget | ✓ | ✗ | ✗ |
| Month History | ✓ | ✗ | ✗ |
| KPIs & Goals | ✓ | ✓ (own scope only) | ✗ |
| Manage Staff | ✓ | ✗ | ✗ |
| Credit-Card Accountability *(new)* | ✓ | ✗ | Earl: ✓ — others: ✗ |

---

## Action permissions

| Action | Admin | Producer | Employee |
|---|:--:|:--:|:--:|
| Submit a Check Turn-In | ✓ (auto-approved → ledger) | ✓ (→ approval queue) | ✓ (→ approval queue) |
| Approve / send back a turn-in | ✓ | ✗ | ✗ |
| Override a calculated value (w/ reason) | ✓ | ✗ | ✗ |
| Add an MGA | ✓ | ✗ | ✗ |
| Add a policy type / carrier | ✓ | ✓ | ✓ |
| Mark a policy MGA-paid | ✓ | ✗ | ✗ |
| Open / close a pay sheet | ✓ | ✗ | ✗ |
| Edit budget lines / archive a month | ✓ | ✗ | ✗ |
| Set KPI targets | ✓ | ✗ | ✗ |
| Add / remove / edit staff + rates | ✓ | ✗ | ✗ |
| Edit own draft | ✓ | ✓ (own) | ✓ (own) |
| Flag form / request help from Sophia | n/a | ✓ | ✓ |

---

## Field-level visibility (the subtle, dangerous part)
Even where an employee can see a *record*, specific **fields must be hidden**. The same policy looks different depending on who's asking:

| Field on a policy | Admin sees | Producer sees | Employee sees |
|---|:--:|:--:|:--:|
| Insured / policy # / dates / type | ✓ | ✓ | ✓ |
| Submitted-by tag | ✓ | ✓ | ✓ |
| Base premium / broker fee (as entered) | ✓ | ✓ (own policies) | ✗ |
| **Commission amount** | ✓ | ✓ (own payout) | ✗ |
| **Net due to MGA** | ✓ | ✗ | ✗ |
| **Producer split / Kaylee flag** | ✓ | own only | ✗ |
| **Agency revenue / grand totals** | ✓ | ✗ | ✗ |
| Override flag (purple dot) | ✓ | ✓ (everywhere except producer pay sheets) | ✗ |

A producer's pay sheet shows **only their own** policies and payout — never another producer's, and never Sophia's agency-gross figures. An individual printed producer sheet deliberately excludes Sophia's block.

---

## Production enforcement checklist (for the engineer)
1. **Authenticate first.** Real accounts with passwords; sessions; password reset. (None of this exists in the prototype.)
2. **Authorize every request on the server.** Map each role to the tables/columns above. With Supabase, this is **Row-Level Security (RLS) policies** on each table + column-level care for the financial fields.
3. **Default-deny.** A new endpoint or column should be invisible until explicitly allowed for a role.
4. **Producers are scoped to themselves** — RLS predicate like `policy.producer = auth.user_name` (use the real user ID).
5. **Immutability** — block edits to closed pay sheets, archived budget months, and append-only rate history at the database level, not just the UI.
6. **Audit who did what** — keep the submitted-by / override-reason / draft-history trails server-side.

---

## Open decision for the credit-card build (Earl)
This build introduces a person (Earl) who needs to see **credit-card data** — which is financial, and therefore something the current rules hide from employees. That's a deliberate, scoped **exception**, and it should be modeled as its own narrow permission (e.g. a `can_manage_credit_cards` capability) rather than promoting Earl to full admin. Whatever Sophia decides (cards only / cards + budget / full admin), record it here once built so the engineer enforces exactly that and nothing more.
