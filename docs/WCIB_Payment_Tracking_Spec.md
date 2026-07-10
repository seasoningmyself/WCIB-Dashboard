# WCIB — Split / Delayed Payments, Audits & Open-Balance Tracking
**Spec for the engineer · drafted July 3, 2026**
Raised by Sophia (audit remittances) and Mercedes (split/delayed insured payments) as the last requirement before handoff. This is a **design spec**, not yet built into the prototype — it changes the ledger data model, so it's captured here for the engineer to build deliberately. (Questions to Sophia timed out; sensible defaults are marked **[default]** and should be confirmed with her.)

---

## The core idea
Today each policy assumes **one full payment in, one net-due out**, both as single lump sums. The turn-in computes:
`net due to MGA = amount collected from insured − commission − broker fee`
and the only remittance state is a **paid / unpaid** switch (`mgaPaid`).

Both new scenarios break that assumption because money moves **over time**. The fix is to track **two running balances per policy** instead of two lump sums:

| Side | Direction | Track | Status |
|---|---|---|---|
| **A — Receivable** | insured → WCIB | total premium · collected so far · balance still owed · due date | paid / **partially paid** / open |
| **B — Payable** | WCIB → MGA | total net due · already remitted · remaining | paid / **partially remitted** / unpaid |

- **Mercedes's split/delayed case** = Side A is partial (insured still owes us).
- **Sophia's audit case** = Side B is partial (we've already sent the MGA prior monthly payments).
- **Mercedes's three asks** all fall out of Side A: partial status (field), alerts (due date), open-balances report (a filtered view).

---

## Scenario 1 — Split / delayed insured payment (Mercedes)
Two sub-cases, both "insured hasn't paid us in full yet, balance due within ~20 days":
- **Deposit now, rest to us within 20 days** — insured pays a deposit; WCIB collects the remainder itself (NOT financed by IPFS, NOT carrier direct-bill).
- **Half now, half within 20 days** — same shape, different split.

This is distinct from the three payment types that already exist (`full`, `deposit`→financed by IPFS, `direct`→carrier direct-bills). **Add a new payment type: "Deposit — balance collected by WCIB."**

**Fields to add to a policy (Side A):**
- `premiumTotal` — full amount the insured owes (already exists as proposal/invoiced total).
- `collectedToDate` — sum received from the insured so far (replaces the single `amtPaid` as the running figure; first receipt seeds it).
- `balanceDueFromInsured` = `premiumTotal − collectedToDate` (derived).
- `balanceDueDate` — **[default] turn-in date + 20 days, editable per policy** (Sophia: "usually 20, but let me change it").
- `receivableStatus` — `paid` (balance 0) / `partial` (some collected, balance > 0) / `open` (nothing collected). Drives the at-a-glance badge.
- When the balance later arrives: **[default] support both** a second ePayPolicy receipt *and* a manually logged check/ACH — each adds to `collectedToDate` and appends to a small `payments[]` history (date, amount, method).

**Net due to MGA when only a deposit is in:** depends on whether WCIB fronts the full remittance or remits as it collects — **must confirm with Sophia** (see Open Questions). Build it flexibly (Side B tracks total / remitted / remaining), so either policy is a matter of *when* a remittance is recorded, not a schema change.

---

## Scenario 2 — Audit with prior monthly remittances (Sophia)
On an audit, the insured pays **monthly**; each month WCIB collects a payment and remits a net amount to the carrier/MGA. By the time the check turn-in is created, **a large portion is already paid to the MGA**, so "net due to MGA" must show only **what's left**, not the whole audit.

**Fields to add to a policy (Side B):**
- `netDueTotal` — total net due to the MGA on the full audit (the existing derived net due).
- `remittedToMGA` — **[default] a single "already remitted to MGA" total** entered on the turn-in (simpler than a month-by-month schedule; revisit if Sophia wants the schedule).
- `remainingNetDue` = `netDueTotal − remittedToMGA` (derived) — **this is what the turn-in and MGA Payables should display as the amount still owed.**
- `payableStatus` — `paid` / `partiallyRemitted` / `unpaid` (upgrades the current binary `mgaPaid`).

Show both figures on the turn-in so nothing looks "wrong": e.g. *"Net due to MGA: $X total · $Y already remitted · **$Z remaining**."*

---

## Mercedes's three asks — where each lands
1. **Payment status tracking** — the `receivableStatus` field (paid / partially paid / open) shown as a colored badge on every ledger row and in the approval queue. Same idea on the payable side (`payableStatus`).
2. **Reminders / alerts** — driven by `balanceDueDate`:
   - **In-app [default, build now-ish]:** a dashboard badge/count + highlighting for balances **coming due** (e.g. within 5 days) and **overdue** (past due date). No dependence on the calendar.
   - **Real email/SMS notifications:** a **production/engineer piece** (needs a server + scheduler; the static prototype can't send mail). Flag as backend work.
3. **Reporting — "Open Balances" view** — a new filtered list of every policy where `receivableStatus ≠ paid`, columns: insured · premium total · collected · **balance due** · **due date** · days-to-due (overdue in red) · submitted by. This is the list Sophia reconciles against the carrier "payment not received / pending cancel" emails at the 20-day mark. **[default] visible to Admin + the submitter**; filterable/sortable by due date and by producer.

---

## Suggested build order (low-risk → higher)
1. Add the Side A / Side B fields to the policy model + migration (default existing rows to `receivableStatus:'paid'`, `remittedToMGA:0` so nothing changes for past data).
2. Turn-in form: new "Deposit — balance collected by WCIB" payment type + the audit "already remitted to MGA" field; live-compute balance due, due date, and remaining net due.
3. Ledger + approval-queue badges for the two statuses.
4. "Open Balances" report view.
5. In-app due/overdue alerts.
6. (Production) real email/SMS reminders — backend.

## Open questions to confirm with Sophia (defaults assumed for now)
1. **Remittance timing:** when only a deposit is in, do we remit the **full** net due to the MGA up front, or **only as we collect**? (Decides whether net-due-to-MGA is figured on the full premium or on collected-to-date.)
2. **Audit entry:** single "already remitted" total **[assumed]**, or a month-by-month schedule?
3. **Balance-collection method:** ePayPolicy second receipt, manual check/ACH, or both **[assumed both]**.
4. **Due window:** 20 days default, editable per policy **[assumed]** — confirm.
5. **Visibility:** Admin + submitter **[assumed]** — confirm employees should see their own open balances.
