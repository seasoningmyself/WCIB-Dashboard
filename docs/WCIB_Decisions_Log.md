# WCIB Dashboard — Decisions Log
**Purpose:** Permanent record of non-obvious decisions Sophia made, so future threads don't re-ask or accidentally reverse them.
**Last updated:** July 17, 2026 (aligned server proposal validation with the recorded two-cent tolerance.)
**Backups:** `backups/wcib_dashboard_v14_2026-06-26_session-end.html` (code); live data in browser storage + original `WCIB-data-merged.json`.

---

## July 17, 2026 — Server and browser share one proposal-tolerance rule

**Recorded correctness fix:** The browser already applied the final-v15
proposal cross-check recorded below: an absolute difference of $0.00, $0.01,
or $0.02 passes, while $0.03 or more fails. The server submission validator
still required exact equality, so a turn-in shown as ready could be rejected at
submit. Browser and server now use one shared integer-cent constant and
comparison function. This changes no stored calculation; it makes the trusted
submission boundary enforce the same approved rounding tolerance as the form.

---

## July 14, 2026 — Managed vocabulary removal is recoverable deactivation

**Recorded production adaptation:** Final v15 hard-removes a carrier, MGA, or
policy type from browser storage when it is not used by the active ledger, and
blocks removal while a live ledger policy uses it. Production preserves the
search, classification, and guarded-removal behavior but changes removal to an
audited `is_active` transition. Deactivated entries leave new turn-in pickers;
their UUID rows and every historical foreign-key reference remain intact, and
admin can reactivate them. The in-use guard considers only non-deleted policies
in the active business generation, so soft-deleted policies and sealed
generations do not permanently pin an entry. State changes write the generic
`vocabulary_deactivated` or `vocabulary_reactivated` action with the existing
carrier, MGA, or policy-type audit entity.

---

## July 14, 2026 — MGA group settlement is one server transaction

**Recorded production adaptation:** Final v15 implements Mark all paid and
Unmark all by looping its single-policy mutation in browser memory. Production
preserves the visible group action and the same differing-state selection, but
runs every policy through the existing audited state-then-placement worker
inside one admin-authorized database transaction. Policies are locked in a
deterministic order; active-generation and soft-delete predicates define the
group; one failure rolls back every state, audit, and open-sheet placement in
that group. Group retries are idempotent, and unmark retains v15's confirmation
that open placements are removed while closed history remains unchanged.

---

## July 14, 2026 — Navigation badges use projected live work counts

**Recorded production adaptation:** Final v15 shows navigation badges for
pending Approvals, unseen flagged Help Requests, and sent-back My Items. Parent
P also requires a My Commissions badge even though final v15 exposes its count
inside the commission summary rather than in navigation. Production therefore
uses the existing projected screen contracts: pending submission count,
unresolved flagged-draft count (there is no prototype-only `seenBySophia`
state), owner sent-back count, and producer `owedCount`. Zero counts stay
hidden. Badge loading never reads raw policy or draft rows and fails closed by
showing no count if an authorized screen API is unavailable.

---

## July 14, 2026 — IPFS automation work queue is streamed from active live policies

**Recorded production adaptation:** Final v15's `exportLedgerCSV` enumerates
**47 columns** (the older session note saying 46 is a stale intermediate count)
and includes only deposit-mode, IPFS-financed, non-manual, not-yet-pushed
policies. Production preserves that final filter and column order, but applies
Parent M's active-generation and soft-delete boundaries: sealed-generation and
soft-deleted policies are not current automation work. The admin-only endpoint
projects each policy through the established admin policy projector before
rendering, streams UTF-8 CSV with BOM and CRLF, applies spreadsheet-formula
escaping, uses `Cache-Control: no-store`, and persists no export file or job.

---

## July 14, 2026 — IPFS pushed state is audited and active-record scoped

**Recorded production adaptation:** Final v15 lets Sophia mark or unmark any
IPFS-financed policy as pushed, stores the transition timestamp, retains the
`IPFS manual` badge precedence for manually handled agreements, and removes
non-manual pushed policies from the automation work queue. Production preserves
that behavior, including allowing a manual agreement to be marked complete,
while writing `policy_ipfs_pushed` or `policy_ipfs_unpushed` atomically with the
state transition. Same-state retries create no duplicate audit event. Only an
active-generation, non-deleted policy can be changed, and every response uses
the admin policy projector. This is an admin-only state; no financial values or
payment references are written to logs.

---

## July 14, 2026 — Manual IPFS policies retain v15 pushed-state actions

**Recorded fidelity decision:** Final v15 permits Sophia to mark any
IPFS-financed policy as pushed, including one flagged for manual handling; its
`toggleIpfsPushed` action does not exclude manual policies. The production
schema originally enforced a stricter `policies_ipfs_state_check` branch that
allowed `ipfs_pushed = true` only when `ipfs_manual = false`. Migration `0048`
relaxed only that branch to match v15, so a manual IPFS-financed policy may now
carry a pushed timestamp. The `IPFS manual` classification and badge remain
unchanged, and manual policies remain excluded from the IPFS automation work
queue. The relaxation therefore restores the approved pushed-state action
without changing queue behavior or losing the fact that a policy was handled
manually. The engagement is a faithful v15 port; where the production schema
was stricter than final v15 without a documented business or security reason,
v15's behavior governs. This is a fidelity correction, not a new feature.

**Client-facing context:** The production dashboard now allows the same
pushed-state actions as the v15 tool Sophia approved, including for financed
policies handled manually. Those policies still show as manual and still stay
out of the automation work queue. This was a deliberate choice to match the
original approved workflow.

---

## July 14, 2026 — IPFS prior-financing detection uses active live history

**Recorded production adaptation:** Final v15 detects a returning IPFS insured
from the single browser ledger, where deleted records no longer exist and there
is no archived business-state concept. The multi-user app preserves that intent
by exact-matching the trimmed, case-insensitive insured name against IPFS-financed
policies in the active business generation with `deleted_at IS NULL`. A
soft-deleted policy and a sealed generation do not influence a new active
turn-in. The endpoint returns only whether prior financing exists and its latest
approval date; it exposes no policy ID, money, contact, carrier, MGA, or account
data. New/Returning remains a human-overridable selection exactly as in v15.

---

## July 14, 2026 — Turn-in proposal cross-check uses v15's two-cent tolerance

**Recorded parity decision:** The production form initially required the entered
proposal or invoiced amount to equal the premium-detail calculation exactly.
Final v15 allows ordinary cent-rounding variance and rejects submission only
when the absolute difference is greater than $0.02. The production form now
uses the same integer-cent rule: differences of $0.00, $0.01, and $0.02 pass;
$0.03 or more fails. This deliberately loosens the stricter ported check to
restore final-v15 behavior without changing any stored financial calculation.

---

## July 14, 2026 — Start Fresh uses recoverable business-data generations

**Recorded production decision:** v15's Start Fresh action irreversibly removes
working policies, approvals, drafts, and pay-sheet data. The multi-user app
preserves the clean-start intent through versioned business-data generations.
No transactional row is deleted or reconstructed: the current generation is
sealed with a versioned manifest, row counts, schema fingerprint, and logical
checksum; a new empty generation is created; Sophia's open pay-sheet chain is
initialized through the existing trusted K1 function; and the active pointer
changes atomically. Frozen closed-sheet policy, rate, adjustment, and total
snapshots are never rewritten.

Identity, staff, credentials, capabilities, producer rates, sessions, offices,
and carrier/MGA/policy-type vocabularies survive. KPI targets copy into the new
generation unless admin explicitly selects the clear-targets option. Audit
events remain global and append-only, with reset/restore events containing
only actor, generation, counts, options, and checksum metadata.

Admin may restore a sealed generation only while the current post-reset
generation still matches its baseline checksum. If any work has been entered,
restore rejects; admin must Start Fresh again to preserve that work as its own
recovery point before restoring an older generation. Restore verifies format,
schema, migration count, row counts, and checksum, then flips the active pointer
to the still-existing rows. Live reads show only the active generation. Sealed
closed sheets remain stored byte-for-byte but are not mixed into the current
generation's history; they return with their original UUIDs and frozen JSON
when that generation is restored.

---

## July 14, 2026 — Start Fresh migration-count compatibility is a tracked hardening limitation

**Known architectural limitation:** Parent M3 stores
`expected_migration_count` in `business_state_control` and requires the live
schema to match that value before Start Fresh can seal and reset a generation.
Every later migration must therefore advance the expected count on apply and
restore it on backout. This is a fragile, non-obvious obligation for migration
authors; migration `0048` initially omitted the update, which broke Start Fresh
until the archived-generation test caught the mismatch and the migration was
fixed. The current design has two safety nets: the static generation-boundary
test checks migration participation, and the reset precondition rejects an
incompatible schema. A missed update therefore fails loudly and immediately
instead of silently creating an unsafe recovery point, but the manual footgun
still exists.

**Decision and recommended hardening:** Retain the current migration-count
mechanism through v15 parity completion because it is tested and protected by
those fail-closed checks. During the Security Hardening or Testing milestone,
make the existing schema fingerprint the generation compatibility gate instead
of the manually maintained count. A generation should seal under its derived
schema fingerprint, and restore should require that fingerprint to match the
live schema. Because the fingerprint changes automatically with the logical
schema, future migrations would have no separate counter to remember. This is
not a feature-completion change: replacing the gate requires full
re-verification of Parent M3's reset, restore, sealed-generation, checksum, and
concurrency guarantees, which belongs in the milestone where those boundaries
are intentionally re-tested.

---

## July 14, 2026 — Approval work deletion is recoverable

**Recorded production decision:** v15 permanently deletes a pending approval
submission and its linked draft. The multi-user app preserves the admin delete
intent as an audited soft-delete with a required reason. Pending submissions
and standalone flagged help requests move to a restricted deleted-work list;
their immutable submitted payload, draft content, lifecycle status, ownership,
and timestamps remain stored and can be restored by admin.

Deleted approval work is excluded from the live approval queue, My Drafts, My
Items, draft-cap counts, and in-review commission reads. Only non-approved
work is eligible. Any queue/draft already approved, linked to a policy, or
represented on a pay sheet is rejected, and this flow never changes or deletes
an approved policy. Delete and restore run through trusted database functions
that lock queue before draft and write one append-only audit event atomically.

---

## July 14, 2026 — Recoverable policy deletion preserves financial history

**Recorded production decision:** v15 permanently removes an admin-deleted
policy and also strips it from closed pay-sheet snapshots. The latter behavior
is a prototype bug because it rewrites a period after settlement. The
multi-user app adapts the admin delete intent as an audited, recoverable policy
soft-delete with a required reason; it never removes the policy row or mutates
closed financial history.

A deleted policy disappears from the live ledger, MGA payables and totals,
open pay sheets and their live KPI widget, My Commissions, My Items/My Drafts,
change-request activity, and correction targets. Any open-sheet associations
are detached in the same transaction, while MGA-paid state and payment history
remain unchanged. Frozen policy, rate, adjustment, and total snapshots on
closed sheets remain byte-identical. Historical KPI actuals continue to derive
from those frozen closed facts, so a policy that was actually settled remains
part of its historical period after live deletion.

Admin may restore the live policy. An unsettled MGA-paid policy returns through
the established placement function and attaches to eligible current open
sheets. A policy already represented on a closed sheet is restored to the live
ledger without any new pay-sheet placement, preventing a second payment. A
shared transaction advisory lock serializes deletion with close and MGA
placement, and an attachment guard prevents deleted policies from being added
to an open sheet.

---

## July 14, 2026 — Correct approved policies in place

**Recorded production decision:** v15 handles a request to change an already
approved record by copying the policy into a new flagged draft. Resolving that
draft can create a second policy ID and leave the original approved policy in
the ledger. The multi-user app preserves the owner-request/admin-review intent
without duplicating financial records.

An originating employee or producer may create a reason-only request linked to
their original approved policy. Creating the request changes no policy field and
creates no draft or policy. Admin may review it as-is, send it back with a
reason, or use the existing audited general-correction or financial-override
path against the original policy ID. The request resolution and any correction
commit atomically. This is an intent-faithful production adaptation of v15's
duplicate-creating behavior; only the established admin correction boundaries
may mutate an approved policy.

---

## July 14, 2026 — Preserve withdrawn submission history

**Recorded production decision:** v15 lets a draft owner reopen a still-pending
submission by removing its approval-queue entry and returning the draft to
editable status. The multi-user app preserves that intent without deleting
review history: the immutable submitted snapshot remains in its queue row with
status `withdrawn`, while the source draft returns to `draft` and its active
queue link is cleared.

Withdrawal is owner-only and available only while the queue entry is still
pending. The trusted database transition locks the queue before the draft,
writes `draft_submission_withdrawn` atomically, and uses the same lock order as
approval and send-back. Therefore a concurrent owner withdrawal and admin
approval serialize to exactly one winner; an acted-on submission cannot later
be withdrawn. This is a deliberate audit-preserving adaptation of v15's queue
row deletion, not a new lifecycle path.

---

## July 13, 2026 — Production chargeback normalization and producer mirrors

**Recorded production decision:** v15's pay-sheet chargeback behavior is preserved through the existing audited adjustment boundary. Positive or negative chargeback input is normalized server-side and in the database to a negative financial adjustment. A chargeback entered on Sophia's House sheet for a producer book or first-year account automatically creates a read-only producer-sheet mirror using that producer's renewal commission and broker rates effective on the adjustment timestamp. Manual adjustments remain explicit and do not create an automatic mirror.

The House source and producer mirror are linked, written through the existing audited create/update/delete functions, and commit atomically. A producer sheet is initialized on the House source period only when the producer has no open chain; any source, mirror, initialization, or audit failure rolls the entire operation back. A zero calculated producer impact creates no mirror. Once either affected sheet closes, its adjustment and frozen totals remain immutable; later corrections belong on the next open period.

Typed adjustment and direct-income dates retain v15's compact and slash-date entry behavior but are normalized to ISO dates before reaching the database. Mirror rows are displayed as House-managed and cannot be edited independently.

---

## July 13, 2026 — Production pay-sheet initialization

**Recorded production decision:** v15's render-time Sophia-sheet ensure and placement-time producer-sheet creation are implemented in the multi-user app as two authenticated, transactional paths. An admin explicitly starts the first Sophia owner chain through `POST /api/pay-sheets/bootstrap`; the inline empty-state selector defaults to June 2026 but allows the one-time starting period to be changed before creation. The first Sophia pay-sheet row is the durable record of that period, so no separate settings table is added.

Producer chains remain lazy. When a producer's first eligible MGA-paid policy is placed, the producer sheet is created in Sophia's **current open period**, not the original bootstrap period, and the creation and policy attachment commit atomically. No producer sheets are bulk-provisioned.

Initialization requires an authenticated admin actor, writes the append-only `pay_sheet_initialized` audit action, serializes competing owner-chain creation attempts, and is idempotent for the established period. If an owner has closed history but no open successor, initialization reports an integrity conflict for review rather than silently repairing financial history.

---

## July 13, 2026 — Production House-sheet cascade close

**Recorded production decision:** v15's final close behavior is preserved through an explicit admin-only close request. Closing a producer sheet closes only that owner. Closing Sophia's House sheet defaults to closing every open producer sheet with activity; the confirmation control provides the same explicit House-only opt-out as v15.

The production transaction is stricter than the single-file prototype: all selected owner sheets close atomically through the existing close function. If any producer close fails, none of the selected sheets close. Successful closes retain per-owner frozen policy, rate, adjustment, and total snapshots; one audit event and one next-period sheet are produced per owner; retries are idempotent; there is no reopen path.

Owner chains remain independent after a House-only close. If Sophia advances while a producer remains on an older open period, subsequent producer work stays on that producer's existing open sheet, matching v15's owner-scoped `getOrCreateOpenSheet` behavior. Only a producer with no open sheet is initialized on Sophia's current period.

---

## July 13, 2026 — Production live pay-sheet KPI widget

**Recorded production decision:** v15's open-period, context-aware pay-sheet widget is rebuilt directly from the existing admin-projected pay-sheet list and detail responses. It introduces no second database aggregation path and no client-authoritative close calculation. Sophia's widget uses the five projected agency totals, current policy classifications, projected per-policy payouts, and projected open-producer totals. Producer widgets use only that owner's projected detail and final payout.

The inline expansion is a native disclosure control and is intentionally session-only. Unlike v15, its open/closed state is not persisted in browser `localStorage`; this preserves the production rule that sensitive financial screens do not copy state into browser storage. Because the app renders one selected owner workspace at a time, v15's cross-widget expansion synchronization has no visible production equivalent.

---

## July 13, 2026 — Add-as-you-go production vocabulary (pending client confirmation)

**Recorded production decision:** v15 shipped with starting carrier, policy-type, and MGA vocabularies. The production app deliberately starts those vocabularies blank and adds entries as work is entered (add-as-you-go); it does not bulk-seed the v15 lists. The schema remains able to accept a reviewed bulk seed later without structural change.

**Confirmation status:** pending client confirmation. If the client requests the full lists preloaded for day one, revisit this as a reviewed data-loading task rather than silently changing the application schema or runtime behavior.

---

## July 2, 2026 — Budget spun out to a standalone Excel workbook (`WCIB_Budget.xlsx`)

**Decision (Sophia):** move the Budget out of the operations dashboard entirely and into a standalone Excel file — NOT a separate project (a separate project = separate browser storage, breaking everything) and NOT a linked second HTML page. Rationale: (1) the dashboard is being handed to an engineer to build into a real multi-user system, and the Budget must never enter that codebase (privacy — it holds personal + business finances); (2) she wants to edit the budget without disrupting the operational workflow/dev; (3) portability — she wants it in OneDrive + on an external drive, accessible at the office and at home. The one dependency (auto-pulled Grand Total Income from the closed Pay Sheet) is dropped: she'll type the gross income herself each month. **The key technical reason Excel/OneDrive wins:** the HTML app stores data in browser localStorage, which does NOT travel with the file — copying the HTML to OneDrive would sync the file but not her numbers. A workbook stores data IN the file, so OneDrive sync makes it truly portable across devices.

**Built `WCIB_Budget.xlsx`** (generated as raw OOXML — no library — 3 sheets, color-coded, formulas live):
- **Start Here** tab: plain-language instructions (how to copy a tab for a new month, enter income, enter/pay bills, read totals), the color legend, and notes (CC "Amount Due" = payoff balance; Annual = reference only; save in OneDrive).
- **TEMPLATE** tab + **July 2026** tab: identical layout, seeded with her real June lines/amounts. Top panel: Gross Income input (yellow box), 30% Tax Reserve (=income×0.3), Total Due / Total Paid / Still To Pay (live sums of category subtotals). Columns: Paid (✔ dropdown) · Item · Amount Due · Amount Paid · Remaining (=Due−Paid, red when negative) · Charged To · Due Day · Auto-Pay · Notes. Categories: Hard Bills (Taxes first), Credit Cards, Employees & Contractors, Business Payables, Business Monthly Subscriptions, Personal Expenses, Annual Subscriptions (reference — excluded from totals). Each category has a subtotal row; frozen header + income panel (rows 1–10).
- **Color coding** (row/item tint): green = business/Uplands, blue = Blueberry, red = Roshak (home), purple = Personal; Credit Cards/Annual neutral. Within each category, lines are ordered by color then alphabetical — matching the dashboard convention.
- Amount Paid seeded blank (starts at 0) so she fills it as she pays each month; Amount Due carries the real recurring figures.

Delivered as a download. The HTML dashboard's own Budget section was left in place for now (not yet removed) — pending a separate decision on trimming the dashboard for the engineer handoff (move Pay Sheets to the end, remove Budget).

**Update (July 2, 2026, Sophia) — added Income tracking, an operating Dashboard, and month-to-month history; rebuilt the workbook.** Goal: make the Excel file able to fully replace the dashboard's Budget + operating/KPI + history views so those can be removed from the HTML.
- **Income section** on every month sheet (top-left, yellow inputs): **Agency / Commission Income**, **Blueberry Rental Income** (new — she wanted Blueberry income tracked), **Other Income** → Total Income. Summary block (top-right): Total Income, Total Expenses, Net (Income−Expenses), 30% Tax Reserve (on agency income), Still To Pay. Hidden **Class** column J on each data row (Business/Uplands/Blueberry/Roshak/Personal/Credit Cards) drives the KPI breakdowns via SUMIF.
- **Pre-built 12 month tabs (Jan–Dec 2026)** instead of copy-a-tab, so history formulas reference fixed sheet names and always resolve. All seeded with the recurring expense lines; income starts blank.
- **Dashboard tab** (operating view): KPI cards (Total Income, Total Expenses, Net, Blueberry Net = Blueberry rent − Blueberry-tagged spend) + a month-by-month history table (Agency/Blueberry/Other income, Total Income, Total Exp, Net, and spend broken out by area: Business/Uplands/Blueberry/Roshak/Personal/Cards, plus Tax Reserve) with a year Totals row. All cells are cross-sheet formulas that fill in automatically as she completes each month.
- Start Here rewritten for the new structure (Dashboard + 12 months, income entry, new-year = copy the file). 14 sheets total, ~570 KB.

**Update 2 (July 2, 2026, Sophia) — clean-slate Dashboard, start July, add-a-line, area & account dropdowns; rebuilt.**
- **Fixed a bug:** the Dashboard totals row showed `#NAME?` in Roshak/Personal/Cards/Tax columns — caused by a column-letter list that stopped at "J", so those totals generated `SUM(undefined…)`. Fixed to full A–N letters.
- **Clean slate / paid-based:** Dashboard now shows **Amount PAID actuals** (by-area via SUMIF on the paid column) and uses a hide-zeros number format (`166`), so future/untouched months and any zero cells display blank instead of `$0.00`. Numbers appear only as she enters income and pays bills.
- **Starts in July:** month tabs are now Jul–Dec 2026 (was Jan–Dec). Plus a **TEMPLATE** tab to copy for new months/years; the Dashboard history table uses `INDIRECT` keyed off a Month-name column (24 rows), so adding a year = copy TEMPLATE, rename, type the name into the next Month cell.
- **Add a line easily:** each category has 2 pre-styled "＋ add a line here" spare rows already inside the subtotal range.
- **Area dropdown:** the former hidden Class column is now a visible **"Area (color)"** column with a dropdown (Business/Uplands/Blueberry/Roshak/Personal/Credit Cards) — this is how a new line tells the Dashboard where to count it (e.g. pick Personal to make it personal).
- **Charged To / Account dropdown:** column F is now a dropdown of all bank accounts + credit cards (Amex, First Tech, Costco, Sapphire, etc.), driven by a hidden **Lists** sheet + `AccountList` defined name.
- **Cheat Sheet** is now the first tab (was easy to miss), rewritten with all the above. Month sheet re-laid so income + summary + 30% reserve sit in a frozen top panel. 10 sheets, ~400 KB.

**Update 3 (July 2, 2026, Sophia) — fixed double-counting; "Total Expenses" is now true Cash Out.** Sophia noticed that bills charged to a credit card are already inside that card's payoff balance, so summing all categories double-counts them. Fix: each line has a hidden **PaidVia** helper (column K) = "CardPmt" for the Credit Cards category, "Ref" for Annual, else a formula `IF(COUNTIF(CardList,ChargedTo)>0,"Card","Bank")` that reacts to the Charged-To dropdown. Month-sheet totals now:
- **★ TOTAL EXPENSES (cash you pay out)** = `SUMIF(Bank, AmountDue) + SUMIF(CardPmt, AmountDue)` — i.e. bills paid from a bank account + credit-card balances to pay off. Card-charged bills are excluded (they're inside the card balances).
- **On cards — already in card balances (ref)** = `SUMIF(Card, AmountDue)`, shown separately up top (the "separate column" Sophia asked for), not added to Cash Out.
- TOTAL PAID SO FAR = paid equivalents; NET = Income − Cash Out; STILL TO PAY = Cash Out − Paid.
Added a **CardList** defined name (the 11 cards) for the classifier. Dashboard "Expenses" column renamed **Cash Out** and now reads each month's cash-out figure (KPI card = CASH OUT (year)); the by-area columns remain a gross breakdown (can overlap with Cards) and are labeled as such. Annual still excluded. Cheat Sheet updated to explain Cash Out vs On-cards. 10 sheets, ~447 KB.

**Update 4 (July 2, 2026, Sophia) — edited IN PLACE (not regenerated) to preserve her entered data; F5 made transparent, Paid/Still-To-Pay removed, Area auto-color, "+" relabeled.** Sophia had uploaded a copy (`WCIB_Budget (3).xlsx`) with real data typed in (agency income 130910.04, hard bills marked paid, etc.). The generator script was NOT saved to the project, and regenerating would have wiped her data — so this round was done as **surgical OOXML edits on her uploaded file** (unzip → regex-edit XML parts → validate with DOMParser → re-zip). Future edits: same approach until/unless the generator is reproduced. Changes, applied to TEMPLATE + Jul–Dec tabs:
- **F5 ★ TOTAL EXPENSES made transparent.** Was `SUMIF(K,"Bank",C)+SUMIF(K,"CardPmt",C)` (correct but opaque). Now `=C22+C38+C59+C67+C87+C97-C8` — sum of the six category subtotal rows minus the On-cards ref. Mathematically identical (both = all bank+card-payment bills, excluding card-charged), but now reconcilable to the visible subtotals. Sophia had expected it to equal just four sections; it legitimately also includes Business Monthly Subscriptions + Personal, and excludes the $811.92 On-cards — explained to her.
- **Removed "TOTAL PAID SO FAR" (F6) and "STILL TO PAY" (F8)** from the top summary — she does the budget once a month, doesn't track partial payments. NET moved up to F6 (right under Total Expenses); F7/F8 right side cleared. Per-line Amount Paid/Remaining columns left intact (she uses them).
- **Area auto-color:** added conditional formatting (7 data blocks × 4 rules, new dxfs in styles.xml) so picking an Area now tints the row automatically — Business/Uplands green, Blueberry blue, Roshak red, Personal purple. Previously the tint was baked per-row at generation time and didn't react to the dropdown.
- **"+" clarified:** the faint spare rows are not clickable buttons (a plain workbook has no macros/buttons). Relabeled "＋ add a line here" → "＋ type a new bill on this row"; Cheat Sheet now also teaches the **group-tabs trick** (Shift-click month tabs to group, type a new bill once, applies to all grouped months) as the answer to "do I have to add a line to every month?" — a static workbook cannot prompt to propagate.
- Set `fullCalcOnLoad` and dropped `calcChain.xml` so Excel recalculates cleanly on open. All XML parts validated. Delivered as `WCIB_Budget.xlsx`.

---

## July 3, 2026 — Blank handoff copy + roster corrections (v15)

Sophia is prepping `wcib_dashboard_v15.html` as the blank build copy for the engineer.

**"Remove all entries" (ledger / MGA payables / pay sheets):** nothing to remove in the file — those already seed empty (`ledger=[]`, `paySheets=[]`, `queueEntries=[]`), and MGA Payables is *computed from the ledger*, so an empty ledger = empty payables. Clarified the key mental model for her: **data lives in her browser (localStorage), not in the HTML file.** When the engineer opens the file on his machine (empty localStorage), the app auto-shows a completely blank state; her test entries stay on her computer only. If she wants her OWN view blanked for an Aug 1 fresh start, that's the existing Settings → Start Fresh reset (not run for her — never clear her localStorage from here).

**Pay Sheet tab stays on the top bar** — she confirmed she likes it there. (The "dormant code" from the v15 trim = invisible backend JS, not the tab; no nav reorder done.)

**Roster corrections — updated the `staffList` SEED** (authoritative for the engineer's fresh copy; her live localStorage already carries her own in-app edits):
- **Joseph: producer → employee** (she'd made him a producer only to test the build). Removed his `gender`/`rates`. Also updated the two stale copy refs that named Joseph as a producer (the dated-rates help text → Kaylee; the gender-backfill line dropped his clause).
- **Sam: removed** — was a dummy; never in the seed, so nothing to change there.
- **Ellyscia: added** as an employee.
- Net seed roster: Kaylee (producer) · Mercedes, Daniela, Joseph, Ellyscia (employees). **Sophia's redundant employee login was removed** (dropped `{name:'Sophia',role:'employee'}` from the seed) —

---

## July 7, 2026 — Manage Staff: edit name + role (was missing)

Sophia reported she couldn't edit staff in Manage Staff. Confirmed: not a glitch — the page only supported **add**, **remove**, and (for producers) edit rates/pronoun. There was no way to change an existing person's **name** or **role** in-app — which is exactly why the earlier Joseph producer→employee change had to be done in the seed code.

**Added inline edit** to each staff card: a ✎ button (next to the ✕) opens an in-card editor with a name input + role select and Save/Cancel, styled with the app's existing classes (`add-staff-input`/`add-staff-select`/`add-staff-btn`/`btn-secondary`) — matched the existing UI vocabulary rather than pulling in an external design system. New state var `_editingStaffIdx` + `editStaff/cancelStaffEdit/saveStaffEdit`.
- **Safe rename:** `renameStaffEverywhere(old,new)` propagates the name across every place it's used as an identifier so nothing orphans — `ledger` (producer/submittedBy/agent), `paySheets` (ownerName + priorItems.producer), `queueEntries` (data.producer/submittedBy/agentMode incl. `house:Name`), `drafts` (ownerName + formData.agentMode), and `currentUser`. Persists ledger/paysheets/queue/drafts/staff and re-renders staff, agent buttons, admin-assign, approvals, ledger, pay sheets, login.
- **Role change:** employee→producer sets role and prompts to set rates (card shows the existing "⚠ No rates set" + Set rates button until done, so Pay Sheet math stays correct); producer→employee keeps rate history dormant (not deleted) in case they switch back. Blocks duplicate names and the reserved name "Sophia" (owner/admin).
- Verified in-app: edit opens/cancels, rename propagates, employee↔producer flips. Header subtitle updated to mention editing.
- Note: this edits the roster in the app; her login still shows her own localStorage roster (incl. a "Sophia" employee entry and full names like "Joseph Gonzalez Perez") — she can now clean those up herself via Edit/Remove. Did NOT touch her live localStorage. she logs in via the separate hardcoded "Admin — Sophia" button (`login('admin','Sophia')`, not generated from `staffList`), which adds check-ins straight to the ledger, so the employee button was just a slower duplicate. Safe because the agency/house pay sheet uses the hardcoded string 'Sophia' via `ensureSophiaSheetExists()`, independent of the roster, and the only admin-time `staffList.find(...currentUser)` is guarded (`if(me && me.role==='producer')`). Logins, agent buttons, and the producer-only My Commissions tab/pay sheet all derive from `staffList`, so roster edits flow to every tab/login automatically. Mirrored into `WCIB_Data_Model.md` (§1 Staff) and `WCIB_Permissions_Matrix.md`. Confirmed to Sophia the demo name-picker login is a prototype stand-in — production uses real email+password auth (Earl was right).

---

## July 3, 2026 (cont.) — Settings trim + payment-tracking spec

**Settings trimmed for handoff.** Removed the **Credit cards** and **Bank / draft accounts** sections from the Settings page (they only fed the retired budget's "Charged To"). Safe because `renderSettings()` guards each block (`if(ce)`/`if(ae)`), so the now-absent `#set-cards`/`#set-accounts` containers are simply skipped — no code change needed there. Renamed "Properties" → **"Office locations"** and rewrote its help text (dropped the Operating-View reference; noted single office, so the turn-in office field stays hidden). Settings page is now **Office locations + Back up & restore**. Confirmed to Sophia that Back up & restore must stay (it backs up ALL data, not just budget) and the Staff tab (MGA/insurance/policy-type lists, Start Fresh) is separate and essential.

**Deferred the deep budget-code strip (deliberately).** Sophia approved removing the dormant budget code, and the archive is done — but the code (~1000+ lines) is entangled with property helpers we keep and with `persistAll`/`hydrate`/`exportAllData`, and isn't cleanly contiguous. With Sophia away (question form timed out), a blind full-strip risked breaking boot for no user-visible benefit (the code is already unreachable). Left it for a verify pass. Recorded in the handoff open items.

**Standalone budget archive delivered.** `WCIB_Budget_Interface_Archive.html` = the pre-trim v14 app (full working Budget/Operating View/History) with a fixed banner explaining it's an archive; for OneDrive. This is the safety copy that lets the budget code be removed from v15 later.

**Payment-tracking spec written** (`WCIB_Payment_Tracking_Spec.md`) for two requirements raised before handoff: Sophia's audit case (prior monthly remittances already paid to the MGA → show *remaining* net due) and Mercedes's split/delayed insured payments (deposit or half now, balance to WCIB within ~20 days). Unified them into a two-balance model (receivable from insured / payable to MGA), each with a partial state; covers Mercedes's three asks (partially-paid status, due-date alerts, Open-Balances report). Not built into the prototype (changes the ledger model); defaults assumed since the question form timed out, with open questions listed for Sophia.

---

--- After the transparent F5 formula above, Sophia asked that Total Expenses reference ONLY the four subtotal rows: Hard Bills (C22) + Credit Cards (C38) + Employees & Contractors (C59) + Business Payables (C67). Changed F5 to `=C22+C38+C59+C67` on TEMPLATE + all six month tabs. Flagged to her that this drops Business Monthly Subscriptions + Personal Expenses and no longer nets out card-charged bills, so it reads higher than true cash-out — accepted.

---

## July 2, 2026 — Dashboard handoff trim (v15) + Pay Sheet → Excel export

Built **`wcib_dashboard_v15.html`** (copied from v14; v14 kept as fallback). Timed-out question form → went with defaults.

**Removed the entire Budget cluster from the UI** (now lives in `WCIB_Budget.xlsx`): the **Budget**, **Operating View**, and **History** nav tabs + their page DOM, the budget delete-scope modal, the Settings → "Budget categories" section, the "reset Budget actuals" checkbox (its two JS reads guarded), the `print-budget` @media block, and the budget refs in the `print-paysheet` hide list. Nav now: Approvals · Help · Ledger · MGA · Pay Sheet · KPIs · Staff · Settings · Turn-In. Verified: no console errors, nav builds without the three tabs, Pay Sheet renders.
- **Approach = SAFE UI removal, not a full JS excision.** The budget JS/data layer is deeply wired (vars, ~1800 lines of functions, migrations, load code, and pay-sheet hooks that call budget fns through `typeof` guards). Fully deleting it blind on her live app was too risky, so the budget render/report/export functions were left DORMANT + unreachable (no nav, no routes). Privacy is still satisfied: the budget template seeds at $0 — her real figures live only in browser localStorage, which does not travel with the HTML file. **Follow-up:** the dormant budget JS + seeded account last-4s can be fully stripped once she can click through v15 and confirm nothing else broke (that strip touches init/migrations/persist, so wants a verify pass).
- Did NOT reorder nav (the separate "move Pay Sheets to the end" idea) — not asked this turn; available as a quick follow-up.

**Added a real Pay Sheet → Excel (.xlsx) export**, alongside (not replacing) the existing PDF. New **"⬇ Export to Excel"** button in the Pay Sheet print bar → `exportPaySheetXLSX()`. Builds a styled workbook from scratch in raw OOXML (no library, `_buildXLSXBlob`/`_xlsxSheetXml` + inline strings + a 9-style stylesheet + store-method zip with CRC32), so it opens cleanly in Excel/Sheets and stays offline/portable. Tabs: **Agency Summary** (5 agency totals from Sophia's open sheet + a by-agent roll-up), **KPI · Activity** (production counts, paid-to-producers, 1st-yr-house-target-$0, account & policy mix, policies by type), then **one detail tab per open agent** (policy line items with broker fee / commission / revenue / payout-or-house-share, a totals row, plus adjustments & direct-deposit sections). Verified: generated zip unpacks to 9 valid parts, all XML parses clean, all CRCs match.

---

---

---

---

First Budget-section work after the Pay-Sheet sign-off. All changes keep the existing design system, login/permission model, and recurring-template/carry-forward mechanics.

**Tax reserve line: 30% is now REFERENCE ONLY; Budgeted is open + editable (Sophia).** Previously the Hard Bills → Taxes line FORCE-wrote its Budgeted = 30% of gross income (read-only). Now `applyAutoTax` only tags the line; it no longer overwrites Budgeted. The cell renders a small accent **"30% ref · $X,XXX"** badge (`.bdg-taxref`, computed by new `autoTaxRef(income)`) **above an open, editable Budgeted input** — Sophia enters her own reserve and the 30% is shown for comparison. Removed the `editBudgetLine` block that prevented editing the tax Budgeted; `refreshBudgetTotals` now refreshes the ref text from current income. The tax line's Budgeted counts toward totals like any hard bill. (Existing data: the input shows the last auto-30% value as a starting point, fully editable.)

**Cleaner, more scannable rows (modeled on Pay Sheets / Policy Ledger).** The per-line meta controls (Type · Property · Charged-to · Due day · Auto-pay) were always-on under every bill, which made the page dense. Now each editable line collapses them ledger-style: a clean row by default, a compact read-only **tag summary** (`.bdg-metasum` — Personal · ↳ card/account · Due N · Auto-pay) when anything is set, and a small **⚙ details toggle** (`.bdg-detbtn`, `toggleBudgetMeta`, transient `bdgMetaOpen` state) that reveals the editable controls only when needed. Closed/archived rows keep their existing read-only tag layout.

**Mortgages carry their real amounts forward + ask before changing future months (Sophia).** Sophia entered the actual Roshak / Uplands / Blueberry mortgage payments. (1) Migration `from < 21` promotes the latest open month's mortgage Budgeted into the recurring `budgetTemplate.hard` so they prefill every future month. (2) New behavior in `moneyBlur`: when a **recurring fixed bill's** Budgeted changes (carried/template line, not a line created this month; credit cards + the income-driven tax line excluded), it prompts **"Update it for FUTURE months too? OK = recurring going forward / Cancel = only this month"** → on OK calls `syncLineToTemplate`. `moneyFocus` stashes the pre-edit value so the prompt only fires on a real change.

**"Worldmark Timeshare" account (••8068) + WorldMark charged-to (Sophia).** Added a bank/draft account **Worldmark Timeshare ·· 8068** to `payAccountList` seed and via migration `from < 21` to live data. Removed the special-case that hid the **Charged to** control on the WorldMark hard bill, so it now has a Charged-to dropdown; migration maps WorldMark → Worldmark Timeshare when unset.

**Credit Cards: recurring toggle removed entirely (Sophia).** The ↻ recurring badge no longer renders on Credit Card rows (cards are always part of the roster). `resolveNewBudgetLine` now auto-marks a newly-named card recurring + syncs to template with no recurring/one-month prompt.

**Credit Cards: "to pay off" balance drives the totals + payoff is reversible (Sophia, June 28 2026).** Follow-up after Sophia went through entering every card balance:
- **Cards count their full "to pay off" balance toward Total expenses** (`computeBudgetTotals`: `exp = c.id==='cc' ? budgeted : actual`), so Remaining (= gross income − total expenses) shows whether income can pay every card off. Bills still count actual-paid. Paid/Unpaid split for cards uses the balance too.
- **Relabeled the Credit Cards category total** to **"to pay off … · paid …"** (was "budget … · actual …"); the top summary card for Credit Cards now shows the **balance to pay off** rather than amount paid.
- **Payoff is now reversible.** `payoffCard` toggles: if already paid off, clicking again clears Paid → $0 and unchecks (button shows **"↶ Undo"**); otherwise copies balance into Paid + checks. **Unchecking the Paid checkbox** on a fully-paid-off card also reverts Paid to $0 (a partial typed amount is left alone). Fixes the stuck "paid off" state after an accidental click.
- **Delete is discoverable on every line.** The row "×" delete button is now always faintly visible (opacity .45, full on hover) instead of hover-only — Sophia couldn't find it to delete an accidental card.

**Column headers in plain words (Sophia, June 28 2026).** For the standard bill layout (Hard Bills etc.) the **"Budgeted" column is relabeled "Amount due"** and **"Actual" → "Amount paid"** — Sophia thinks of budgeted as the amount due and actual as what she's paying. The checkbox column stays "Paid" (status); "Variance" unchanged. The per-category quick-reference total (category header, right side) likewise reads **"amount due … · amount paid …"** (was "budget … · actual …") for all standard categories; Credit Cards keeps "to pay off … · paid …", Annual stays "reference only".

**Variance color now follows the sign (Sophia, June 28 2026).** Flipped `varClass`: a **positive** variance (amount paid > amount due — e.g. the double mortgage payments) is **green**; a **negative** variance (paid < due) is **red**; ~0 is grey. (Was the reverse "over-budget = red" logic.) Only affects the non-CC variance column; Credit Cards' carried/paid-off colors are unchanged.

**Employees grouped by property (Sophia, June 28 2026).** The Employees category now renders its lines grouped under a sub-header per assigned Property (e.g. "Roshak — Home", "Uplands — Office", "Blueberry — Rental"), ordered by the property list with **Unassigned last**. Grouping is display-only (data/line objects unchanged); new employees land in Unassigned until a Property is set. New `.bdg-subgroup` style; only the `emp` category is grouped. **Within each property group, property-upkeep people** (name matches landscaping / cleaning / maintenance / janitor / lawn / groundskeeping) **sort to the bottom**, below the direct WCIB hires — e.g. "Hector — Uplands Landscape" sits last under Uplands (he runs the property, isn't a direct hire). Heuristic is name-based + display-only.

**Alphabetical ordering across Budget categories (Sophia, June 28 2026).** (1) **Credit Cards** render A–Z by name (unnamed just-added lines stay last). (2) **Hard Bills** now show the **Taxes** reserve as its own sub-section ("Taxes — tax reserve") first, then every other bill under a "Monthly bills (A–Z)" sub-header, alphabetical. (3) **Employees** are A–Z within each property group (property-upkeep people still sorted to the bottom of their group). All ordering is display-only via a shared `byName` comparator; data/line objects are untouched.

**Employees: "Amount paid" is checkbox-driven (Sophia, June 28 2026).** Employees are no longer single-column. The **Monthly (est.)** column is the amount due; the **Amount paid** column stays blank ("—") until the row's **Paid** box is ticked, then it shows the full monthly estimate (green); unticking clears it to $0. The category total reads "amount due (sum of estimates) · amount paid (sum of ticked)". No variance column for employees. Implementation: `toggleBudgetPaid`/`editBudgetLine` keep `actual = paid ? budgeted : 0`; `computeBudgetTotals` derives the emp paid amount from the checkbox (self-healing vs legacy data where actual==budgeted); employees now count their full monthly estimate toward Total expenses (like credit-card balances — payroll she must cover). Migration `from < 22` (BUDGET_SCHEMA → 22) normalizes stored emp actuals in open months.

**Readability pass on the Budget summary (Sophia, June 28 2026 — "lay it out like the Pay Sheet").** (1) The sticky summary totals now carry **color-coded left borders** like the Pay Sheet's total cards — Gross income (green/accent), Total expenses (grey), Remaining (green), Paid (green), Unpaid (amber). (2) **Trimmed the verbose formula notes** under each total to short plain labels ("Bills + cards + employees + payables", "Gross income − expenses", "Marked paid so far", "Still to pay"). (3) **Removed the redundant category-totals strip** (`#bdg-cat-totals`, the 7 mini-cards) — it duplicated each category header's "amount due · amount paid", so the summary + category headers now carry the totals without the extra band. (Population JS is a guarded no-op; can be restored if wanted.)

**Restored the full employee roster from the June 25 backup (Sophia, June 28 2026).** Sophia had entered job titles + hourly/standard/OOO rates + bonuses + the TS Landscaping mailing address; this detail lived in her data (recovered from `WCIB-data-merged.json`, June 2026 open month), NOT in any HTML code seed (v11's code only had bare names — that's why it wasn't carrying). Updated `budgetTemplate.emp` to the detailed roster and added migration `from < 23` (BUDGET_SCHEMA → 23) that rebuilds the template and fills the detail into open months: restores each employee's name (with role), notes, type (business/personal) and property, plus the monthly amount **where the line was blank** — preserving any amount/paid Sophia had already set (matched by name keyword incl. renames like "Blueberry"→Todd, bare "Hector"→Hector — Roshak Landscape). Roster: Kaylee Salary/Commission, Mercedes – CSR/Backoffice, Daniela – Renewals Specialist, Joseph – Agent & Renewals Specialist, Tracy – Housekeeper, Tracy – Blueberry Cleaning, Earl – AI Generalist/Operations, Hector – Roshak/Uplands Landscape, Francisco – House Cleaner, Todd – Landscaping, Alicia – Filing Front Desk, Ellycia – CSR, Chloe – Executive Assistant, New Employee.
**Tracy — Blueberry Cleaning defaults to $0 (Sophia, June 28 2026):** it's per-cleaning (only on tenant turnover), so it no longer prefills an amount — migration `from < 24` (BUDGET_SCHEMA → 24) zeroes it in the template + open months; Sophia populates it the months it happens.
**Vistage moved to Business Monthly Subscriptions (Sophia, June 28 2026):** the seed had drifted back to Business Payables; migration `from < 25` (BUDGET_SCHEMA → 25) moves Vistage payables→misc in the template + open months, and the seed now lists it under misc.

**Auto-alphabetize on rename/add + fix detail-panel "Done" not refreshing (Sophia, June 28 2026).** (1) Name inputs now call `commitBudgetName` on commit (blur/Enter), which re-renders so the sorted categories (Credit Cards, Hard Bills monthly bills, Employees) re-alphabetize a new or renamed item into place. It's deferred + focus-guarded (skips the re-render if you've tabbed to the amount field in the same line, so it never rebuilds the DOM mid-entry). Budget *categories* themselves are fixed (rename-only in Settings); this is about line items within a category. (2) **Bug fix:** setting charged-to account / auto-pay / due / type / property in a line's detail panel saved the data but only refreshed the by-card rollup, so pressing **Done** left the collapsed summary tags stale (looked like it didn't update). `toggleBudgetMeta` now re-renders on collapse, so the row's summary tags reflect the edits immediately (verified on IRA → "↳ Operating Biz account · Auto-pay").

**Business Monthly Subscriptions: alphabetized + grouped (Sophia, June 28 2026).** The `misc` category now sorts A–Z and groups into **"WCIB business expenses"** (lines with no property or the Uplands office) and **"{Property} business expenses"** per tagged property. Added a Property control to misc lines (was hard/emp/income only). Added four **Blueberry business expenses** utilities — **PGE, Garbage, Internet, Water** (property=blueberry, $0 default) — to the template + open months via migration `from < 26` (BUDGET_SCHEMA → 26). Note: misc still doesn't count toward Total expenses, but property-tagged misc lines DO flow into the By-property rollup, so the Blueberry utilities reduce the Blueberry net.
**Bug audit (June 28 2026):** exercised edit-amount, toggle-paid, set charged/due/scope/property, add/delete, CC payoff+undo, employee paid, tax-reserve edit, computeBudgetTotals, and localStorage persistence across all categories — all pass, no console errors. No outstanding bugs found; the earlier "not working" was the detail-panel Done-refresh issue (now fixed) plus Subscriptions not yet grouped/sorted.

**Budget column alignment / zoom fix (Sophia, June 28 2026).** The Budgeted/Amount-due/Paid columns drifted out of line with the header and overflowed when zoomed in. Cause: the header row and each data row are separate CSS grids, and the data rows' `<input>` fields carry a default intrinsic min-width that prevented the `fr` columns from shrinking to the header's proportions. Fix is CSS-only: `.bdg-row>*{min-width:0}` and `min-width:0` on `.bdg-in`, so grid children shrink to their `fr` share. Verified header and data column templates now match exactly and no row overflows at narrow widths. **No data or pay-sheet changes** — this was purely a layout rule.

**Data audit / "everything is gone" scare (June 28 2026 — RESOLVED, no data loss).** Sophia closed the app mid-session (it was running slow) and on reopening thought her pay sheet was wiped and June's ~$103K closed total was gone. Full audit of live `localStorage` vs her own June 25 backup (`WCIB-data-merged.json`): **nothing was deleted, and no pay-sheet data was ever touched this session (all changes were budget CSS/logic).** Findings: June house sheet intact with 62 attached policies + 4 ACH/check deposits ($14,562.37); Policy Ledger had *grown* to 107 entries (was 93 at backup); budget still May-closed + June-open. The June sheet is stored **open** (no close snapshot / `closedAt`) — and her June 25 backup shows the **identical** open state, so the close never persisted to this browser. The sheet *as attached* totals **$65,822.71** (trust $51,260.34 + checks $14,562.37). The remaining ~$37K is real but **unattached**: 48 ledger policies whose "on pay sheets" link is empty = $31,961 in broker fee + commission, plus a 12-policy producer sheet and **42 items still in the turn-in queue**. 65,822 + 31,961 ≈ **$97,784**, ~$103K with queue/producer — i.e. policies that never went through Approvals onto the open sheet. **Pending Sophia's decision** (not yet actioned): (a) attach the 48 unattached ledger policies to June, (b) work the 42-item queue through Approvals first, then (c) close June so the Budget references a locked Grand Total Income.

**New "Personal Expenses" category (Sophia, June 28 2026).** Added a 6th expense category `personal` (BUDGET_CATEGORIES, after Business Monthly Subscriptions) for monthly personal bills. Seeded **Daphne Therapy, Sundance Boat Rental Storage, PGE, Northwest Natural** ($0 — she fills amounts), alphabetized A–Z. Single-amount layout (Amount due + Paid checkbox, like Business Payables — added to `isOneAmount`); the Type/scope control is hidden (the category is inherently personal). **Counts toward Total expenses** (added to the expense-category list) and rolls into the **personal** scope total (`computeBudgetTotals` treats `c.id==='personal'` as personal scope regardless of per-line scope). `editBudgetLine` mirrors actual=budgeted like payables/misc. Template + open months seeded via migration `from < 27` (BUDGET_SCHEMA → 27). NOTE: if Sophia wants personal bills OUT of the business Total-expenses figure, flip the one flag — flagged to her.

**Classification color-coding (Sophia, June 28 2026 — "make it visually easy to read").** Every budget row now carries a 3px left accent bar by classification, and grouped sub-headers are tinted to match: **business / Uplands = green (#16a34a)**, **Blueberry = blue (#2563eb)**, **personal / home incl. Roshak = purple (#9333ea)**. Logic (`bdgAccentClass` / `bdgPropAccent`): property wins over scope — Blueberry→blue, Uplands→green, Roshak→purple (home); otherwise personal-category/personal-scope→purple, business default→green. Credit Cards / Income / Annual stay neutral (Credit Cards are a payment vehicle, not a scope). Applied to all three row render paths (open, credit-card, closed read-only) and to the Employees + Subscriptions sub-group headers. Pure CSS classes (`.bdg-acc-*`, `.bdg-subgroup.acc-*`); no data changes. **Update (Sophia, June 28 2026):** Roshak changed from purple → **orange (#f97316)** — purple and blue read too similarly side by side; personal (non-Roshak) stays purple.
**Update 2 (Sophia, June 28 2026):** Roshak orange → **red (#dc2626)**. Plus two structural changes: (1) **Within every category, lines now sort by color group, then alphabetical within each color** (rank green→blue→red→purple; `byColorName`). Categories with property sub-headers (Employees, Subscriptions) keep their headers but the groups are now ordered by color; Hard Bills keeps Taxes-first then color/A–Z. (2) **Color filter bar** above the categories (`#bdg-filterbar`, `bdgColorFilter`, `setBudgetColorFilter`): chips **All · Business · Uplands · Blueberry · Roshak · Personal** (color-dotted) show only that classification across the whole budget, hiding categories with no matching lines — so Sophia can look at "just Blueberry" / "just Uplands" / etc. Filter is by fine **class key** (`bdgClass`), not raw color, so Business and Uplands (both green) filter separately. Refactored classification into `bdgClass` → `CLASS_COLOR` → `bdgAccentClass`/`bdgColorRank`. Filter is transient (not persisted); totals/by-card sections remain global (full month), only the line lists filter. Verified: Roshak=red, 0 orange left; Blueberry filter shows only blue lines across 3 categories; Uplands filter isolates the 15 Uplands-tagged lines; no console errors.

**Re-confirmed in this turn's audit:** Business Monthly Subscriptions is alphabetized and split into "WCIB business expenses" + "Blueberry business expenses" (Garbage/Internet/PGE/Water). Full flow audit (classification spot-checks, personal edit/paid/add/delete, totals math, scope rollup, persistence) all pass; no console errors.
**OPEN (still to confirm with Sophia):** what "the version 11 layout" specifically means — the current budget already has this session's redesign (tax reference, property grouping, alphabetical, checkbox-driven employee paid, colored totals); did not revert layout pending her clarification.

Verified live (admin/Sophia → Budget): 7 categories render; tax ref "30% ref · $31,173.01" with editable Budgeted; 39 detail toggles + summaries; 0 rec badges under Credit Cards; WorldMark summary "Personal · Roshak · ↳ Worldmark Timeshare · Due 3 · Auto-pay"; Worldmark Timeshare present in Charged-to dropdowns; detail panel expands (5 controls) / collapses cleanly; schema = 21.

--- Sophia: IPFS's quote flow lets you pick a NEW insured or click an EXISTING (pre-populated) insured if financed before. Clicking the existing insured keeps their prior IPFS account & auto-pay setup (e.g. last year's policy renewing) instead of forcing a brand-new account. The automation needs to know which. Decision: **capture it on WCIB's end as a field so the automation export carries the flag** (the automation can't reliably know account history; WCIB's ledger does).
- New toggle in the IPFS contact block: **"Have we financed this insured with IPFS before?"** → *New IPFS insured* / *Returning — keep their account*. State `ipfsReturning` ('' | 'new' | 'returning'), setter `setIpfsReturning`.
- **Auto-detect (`refreshIpfsReturning` + `ipfsHistoryFor`):** scans the ledger for a prior IPFS-financed entry with the same insured name (case-insensitive, excludes the record being corrected via `_editingLedgerId`). If found, pre-selects **Returning** and shows an amber banner ("⚑ We've financed [insured] with IPFS before (last financed [date]). They likely already have an IPFS account — choose Returning to keep their auto-pay & setup."); if not, defaults **New**. The human can override (`_ipfsReturningUserSet` stops auto-detect from clobbering an explicit pick). Re-runs as the insured name is typed (m-insured oninput) and when the finance block is shown (setPayMode/setIpfsFinanced).
- **Required** when IPFS + not manual (mValidate). Persisted in `formSnapshot`/`loadSnapshotIntoForm` and both ledger-entry builders (only when deposit+IPFS, else '').
- **Automation export:** new column **"IPFS insured status"** → "Returning — link to existing IPFS account (keep auto-pay)" / "New IPFS insured — create account". Ledger detail shows an "IPFS insured: Returning/New" line. Legacy pre-existing financed records have no value → export blank (expected; new submissions carry it).
- Verified live: new insured→New (no banner); repeat insured (Oregon United Construction LLC.)→auto-flips Returning + banner with last-financed date; manual override to New holds against re-detect; export strings correct.

**IPFS finance: removed "Contact name", automation now references the insured name from Policy information (June 28, 2026, all logins).** Sophia: IPFS doesn't ask for a contact name — they ask for the **insured name**, which is already the first field of the Policy-information section (`m-insured`). So: (1) removed the **Contact name** field (`m-fin-name`) from the IPFS contact block (block now: Mobile number, Email address, Mailing address); (2) removed its required-field validation; (3) dropped `financeName` from `formSnapshot`/`loadSnapshotIntoForm` and the `name` key from the `financeContact` object in both ledger-entry builders (live submit + approve-from-draft); (4) the IPFS automation export row is now **`['IPFS Insured name (from policy information)', p=>p.insured||'']`** — reads the live insured name directly, so it's always current even if the insured is later corrected; (5) the ledger detail "IPFS contact" line now shows `p.insured` + mobile/email/address. Note: pre-existing financed records still carry a legacy `financeContact.name` in storage — harmless, nothing reads it anymore. Verified live: financed flow shows only Mobile/Email/Mailing address; export insured-name column resolves to the entry's insured ("Oregon United Construction LLC.").

## June 28, 2026 — Pay sheet polish: close button to top, maintenance tools to bottom

**Close button moved to the top of each sheet; restore/prior-items tucked away (June 28, 2026).** Per Sophia, now that everything's integrated:
- The **"Close [month]" action bar moved to the TOP** of each open sheet (right under the sheet header), instead of the bottom — so it's reachable without scrolling past a long sheet.
- The **Restore point** and **Prior items** bars moved off the top into a collapsed **`<details>` "Maintenance & data tools"** section at the very bottom of the Pay Sheets page (kept for occasional/future use, de-emphasized). Same IDs/handlers; `updateRestorePointBar`/`updateImportBar` are position-independent. Hidden on print.
- Verified: action bar renders before the sheet body; maintenance section is the page's last child with both bars inside; no duplicates; no console errors.

**STATUS (June 28, 2026):** Everything through the Pay Sheets is considered done/ready for engineering handoff (check turn-in flow, Approvals, Policy Ledger, MGA Payables, Pay Sheets, KPIs, producer logins, financing/IPFS automation hooks, transaction-type taxonomy incl. Won Back). Budget tweaks are the next area of work.

## June 28, 2026 — Closing the House sheet closes all producer sheets by default

**Closing Sophia's (House) pay sheet now cascades to all producer sheets, by default (June 28, 2026).** Sophia didn't want to manually close the House sheet and then each producer's separately. Refactored `closePaySheet`:
- Extracted `_closeOneSheet(sheet)` (pure: snapshot + mark closed + open next month; returns `{ok,reason}` — a producer with no rates set returns `{ok:false}`), `_afterPaySheetClose()` (persist + render + budget refresh), `_sheetHasContent(s)` (policies OR prior items).
- **Producer "Close" → closes just that one** (unchanged behavior, with its confirm + rate check).
- **House "Close" → default closes the House sheet AND every open producer sheet that has content.** Flow: confirm 1 = "Close all N producer sheets too? OK = House + all producers (recommended) / Cancel = House only" (the **opt-out**); confirm 2 = final "Close [summary] for [month]?". Producers lacking rates are skipped and reported in a follow-up alert (House still closes). Each closed sheet opens its own next month.
- Close button on the House sheet now reads **"Close [month] (House + producers)"** and the actions-info line notes the cascade + opt-out.
- Verified live: closing Sophia June closed Sophia (51) + Kaylee (18) for June and opened July for both; opt-out path (Cancel on dialog 1) closes House only. Test close then reverted so the user's data is untouched. No console errors.

## June 28, 2026 — "Won Back" is now a first-class transaction type (platform-wide)

**Won Back added as a transaction type; Rewrite coverage/won-back sub-toggle retired (June 28, 2026, all logins).** Sophia wanted "Won Back" as its own transaction type everywhere, with canonical, shared definitions. Confirmed definitions (encoded in tooltips/key across turn-in → ledger → pay sheets → KPIs):
- **New** — a brand-new policy/client we didn't have before.
- **Renewal** — a policy we already hold, continuing into a new term (client retained).
- **Rewrite** — same client we KEPT, moved Carrier A→B (usually mid-term) for a coverage need. Never lost.
- **Won Back** — a client we had, LOST for that specific policy, and have now recaptured (there was a gap).
- **Cross-sale** — a new line of coverage for an existing client.
- **Endorsement** — mid-term change. **Audit** — premium true-up.
- One-liner: **Rewrite = never left; Won Back = was lost, now recaptured.**

Changes:
- **Turn-in:** added `Won Back` to the transaction-type dropdown. **Removed the Rewrite coverage/won-back sub-toggle** (`rewrite-subtype-row`, `setRewriteType`, the `rewriteType` validation requirement, and its onTxnTypeChange/reset/snapshot DOM refs) — Rewrite now means only the coverage move; won-back is its own type. The `rewriteType` field remains in the data model but inert (always '').
- **Definitions key on the check-in:** the transaction-type field is now full-width (`field s2`) with the dropdown on the left and a **"Transaction type key"** list (`.txn-key`, all 7 types defined) to its right, so a new employee can categorize correctly at a glance.
- **Chips/order:** new `.tag-txn-wonback` chip (emerald, distinct from Rewrite's pink); `'Won Back'` added to `txnChip` map and `TXN_ORDER` (last). Renders everywhere chips show (ledger, MGA, pay sheets, KPIs).
- **Producer book breakdown:** `isWonback = txntype==='Won Back'`; Renewals card now = `Renewal || Rewrite` (all rewrites are coverage = retained); Won-back card = Won Back type.
- **KPIs:** company "Won-back clients" card filters `txntype==='Won Back'`; `kpiTxnTypeHTML` simplified (removed the Rewrite COVERAGE/WON-BACK split — each is now its own txntype group); tooltips updated to the new definitions.
- **Migration (hydrate):** legacy `txntype==='Rewrite' && rewriteType==='wonback'` entries auto-convert to `txntype='Won Back'` (rewriteType cleared) across ledger, queue, drafts, and pay-sheet snapshots + prior-items — so existing data picks up the new type on load.
- Verified: dropdown + 7-item key render; sub-toggle/`setRewriteType` gone; chip + order correct; breakdown classifies Won Back (1) / Renewals incl. rewrite (2) / Cross-sales (1); no console errors.

## June 28, 2026 — Producer book breakdown: Renewals (incl. coverage rewrites), Cross-sales, Won back

**Book-of-business breakdown re-categorized for goals (June 28, 2026).** Sophia wanted the producer book breakdown to reflect goal-relevant categories, aligned with the rewrite sub-types from the check turn-in. New `paySheetBreakdownHTML` cards (book only; first-year still excluded → incentive callout):
- **New business** — txn New.
- **Renewals** — txn Renewal **plus coverage rewrites** (txn Rewrite where rewriteType ≠ 'wonback' — an insured moved carrier A→B mid-term for coverage; client retained). `isRenewalCat`.
- **Cross-sales** — txn Cross-sale (its own card, since cross-selling is a stated goal).
- **Audits & endorsements** — txn Audit/Endorsement.
- **Won back** — txn Rewrite where rewriteType==='wonback' (previously lost clients rewritten back from a prior cancelled policy). `isWonback`.
- Ties to the June 27 rewrite sub-type split (coverage vs won-back): coverage rewrites count as retained business (Renewals); won-back rewrites are the recapture metric (own card).
- Also: `priorItemToRecord` now preserves `rewriteType` (was hardcoded '') so the Won-back card is correct for any tagged rewrite; prior Excel imports carry no sub-type, so their rewrites default into Renewals (coverage) — fine, real won-backs flow in via the turn-in going forward.
- Verified: Kaylee → New 0, Renewals 12 (incl. a coverage rewrite), Cross-sales 0, Audits & endorsements 3, Won back 0; no console errors.

## June 28, 2026 — First-year payout = target $0 (highlighted on agency views)

**First-year house payout surfaced as a target-$0 KPI (June 28, 2026).** Sophia's goal is to pay $0 on first-year house accounts (they should stay 100% house, not be paid out as a producer incentive), and she wanted that visible/visual on the agency views.
- **KPIs page (Company-wide):** the "Producer payouts" section now leads with a prominent **target-$0 banner** (`.kpi-zero-target`) — big number, **red** (`--flag`) while any first-year payout remains with "⚠ Above target" + per-producer breakdown ("Across N policies — Kaylee $X…"), flipping **green** (`--ok`) with "✓ At target ($0)" at zero. The redundant small "1st-yr house paid" card was removed; "Total paid to producers" + "Book paid" cards remain. (Reads closed sheets, like all KPIs — turns red once a period with first-year payouts closes.)
- **Sophia pay-sheet "at a glance" widget:** added a highlighted **"1st-yr house paid · target $0"** money stat (red bg if >$0, green +✓ at $0), computed live from open producer sheets — so it's visible right on the Sophia tab without opening KPIs.
- Verified: Sophia widget shows red $2,340.33 with the import applied; KPI banner generates with over/met states; no console errors.

## June 28, 2026 — Producer breakdown: strictly book of business

**"Goals & incentives" breakdown made strictly book-of-business (June 28, 2026).** Sophia: this breakdown must reflect the producer's OWN book, not first-year (first-year is an incentive, not book production). Rewrote `paySheetBreakdownHTML`:
- All cards compute over **book records only** (`kaylee!=='house'`); first-year (`kaylee==='house'`) is excluded and shown as a separate dashed **"Incentive · 1st-year house"** callout (`.ps-bd-incentive`, count + payout) below the cards.
- Cards: **New business** (book, txn New), **Renewals / existing** (book, txn Renewal), and — per follow-up — the 3rd card repurposed from "Book of business" to **"Audits & endorsements"** (book, txn Audit/Endorsement).
- Per follow-up: **removed the "brought in $X" agency-revenue figure** from every breakdown card — each now shows only "paid $X" (the producer's payout). (Agency-revenue KPIs elsewhere are unaffected.)
- Note: the three cards are lenses, not a strict partition (a book Cross-sale/Rewrite won't appear in any of the three) — intentional per Sophia's specified categories. Verified: Kaylee → New 0/$0, Renewals 11/$3,129, Audits & endorsements 3/$503.67, no "brought in" anywhere, first-year shown only in the incentive callout.

## June 28, 2026 — Single-producer "Print sheet" was also printing Sophia's sheet

**Fixed: a producer's "Print sheet" printed that producer + Sophia (June 28, 2026).** On a producer's pay sheet, clicking "Print sheet" produced Sophia's full house sheet plus the producer's. Cause: the agent sub-tab marks non-active blocks `ps-tab-off`, and the print CSS force-shows tab-off blocks (`body.print-paysheet .ps-person-block.ps-tab-off{display:block!important}`, specificity 0,3,0) so the **full agency report** can print everyone. `_paySheetPrint(filterFn)` hides non-matching blocks with `.ps-print-hide` — but `body.print-paysheet .ps-print-hide{display:none!important}` is only (0,2,0), so on a block carrying BOTH classes (Sophia, while viewing Kaylee) the tab-off force-show won the cascade and Sophia printed anyway.
- Fix: added `body.print-paysheet #page-paysheet .ps-person-block.ps-print-hide{display:none!important}` — specificity (1,3,0) via the page id, so print-hide always beats the tab-off force-show regardless of rule order. The full-agency report is unaffected (it sets no `ps-print-hide`, so tab-off blocks still force-show).
- Net: a producer's "Print sheet" now prints ONLY that producer's sheet (their book + 1st-yr house + their chargebacks); "Print full agency report" still prints everyone. Verified the class state resolves correctly (Sophia → ps-tab-off + ps-print-hide → hidden; active producer → shown); specificity analysis confirms the print-media outcome (the `@media print` rules don't apply on screen, so this was reasoned via the cascade, not a screen snapshot).

## June 28, 2026 — Per-section running totals on pay-sheet group headers

**Each account-group header on the pay sheets now shows that section's total (June 28, 2026, all sheets).** Sophia wanted to see, while scrolling, the sum of each section (House / Producers' book / 1st-yr house) right in its header.
- **Sophia sheets:** the group header shows **"Section total $X"** = sum of broker fee + commission for that section's rows (policies + imported prior items), right-aligned (`.ps-group-sum`, `margin-left:auto`). Tooltip breaks it into "Broker fees $X · Commissions $Y".
- **Producer sheets:** shows **"Section payout $X"** = sum of producer payout for that section (rate-computed policies + prior items' explicit payout).
- Reconciles correctly: Sophia section totals sum to the gross (Total to Pull from Trust **before** chargebacks — chargebacks live in their own section and are subtracted at the bottom, so they're intentionally not in any account-group total). Producer section totals sum exactly to the payout grand total.
- Renders on open and closed sheets (same `renderSheetBody`). Verified live (51-policy state): Sophia House $64,963.59 + book $15,364.17 + 1st-yr $9,361.41 = $89,689.17 = Trust $89,347.67 + $341.50 chargebacks; Kaylee book $3,841.03 + 1st-yr $2,340.33 = $6,181.36 payout. No console errors.

## June 28, 2026 — Import prior Excel pay-sheet items (pre-system, paid)

**Imported the 59 already-paid June 2026 items from Sophia's old Excel pay sheet (June 28, 2026).** Before this dashboard, Sophia tracked check turn-ins → MGA payables in an Excel workbook. She wanted those already-paid items onto the June pay sheet — itemized like the Excel, grouped House / Kaylee book / Kaylee first-year, **on the pay sheet only** (not Ledger/MGA/Approvals), but **counting toward totals + KPIs** (real June production).

**Source mapping (Excel `06 - June 2026 Paysheet.xlsx`):** Sheet 1 = the pay sheet (col B flags "Kaylee" on book accounts; D=broker fee, E=commission, F=ins type, I=txn). Sheet 2 rows 62–73 = "Kaylee Accounts" with her exact payout (col F). Rule (per Sophia): a Sheet-2 account ALSO flagged Kaylee on Sheet 1 = her **book**; a Sheet-2 account NOT flagged on Sheet 1 = **first year**. The 12 Sheet-2 accounts are a subset of the Sheet-1 rows (not additional).
- **62 Sheet-1 rows − 3 negatives (already entered as chargebacks by Sophia) = 59 imported.** Of 59: **47 house, 4 Kaylee book, 8 Kaylee first-year.**
- Kaylee book (4): PNW Prestige IM $208.36, PNW Prestige GL $331.36, Superior Framing $21.87, Tree Talk $247.22. First-year (8): CJ GL $37.01, CJ Res.Bond $21.87, Timberline Res.Bond $21.87, Roofex GL $253.93, Timberline GL $207.64, Welfare $315, Viva WC $250.35, Roofex WC $250. **Payout total $2,166.48** (= Excel Sheet-2 r88). Kaylee payouts use the Sheet-2 exact amounts (per Sophia), not rate×commission.
- Data rules (Sophia): broker fee **NA → $0**; commission **TBP/TBD → "TBD"** (counts 0 toward commission, like a carrier-pays-later comm) — applies to Guzman/KEN/Odyssey (house) and Viva/Roofex WC (Kaylee, but their payout is still set from Sheet 2). Txn types mapped to dashboard values (New Biz→New, Crossale→Cross-sale, Endorse→Endorsement). Poltype kept as the Excel abbreviations (faithful to her sheet).
- **Reconciliation (verified):** the 59 positive items sum to **$32,881.66 broker + $18,378.68 commission** = the Excel Sheet-1 totals ($32,627.66 + $254 removed-negatives; $18,291.18 + $87.50). Exact match.
- Note: **Delatour Electric, LLC.** (the account Sophia asked about earlier as "missing") is r44 here — a house account ($0 broker / $87.50 comm, Rbond, Renewal). It was in the old Excel, never entered in the dashboard. Now imported.

**Implementation — pay-sheet-local "prior items" model (NOT ledger):** Stored as `priorItems[]` on the June 2026 Sophia sheet (`{insured, brokerFee, commission, commTBD, poltype, txntype, acctKind:'sophia'|'book'|'house', producer, payout}`). Honors "out of ledger/MGA" literally — they exist only on the pay sheet. KPIs read pay sheets (`sheetPolicyRecords` → snapshot), so prior items feed KPIs via `priorItemToRecord` while staying out of the Ledger/MGA/Approvals/duplicate-detection entirely.
- Helpers: `juneSophiaSheet()`, `priorItemsForSheet(sheet)` (Sophia → all; producer → their subset by name), `priorItemToRecord(it,sheet)` (record shape matching `sheetPolicyRecords`; kaylee field sophia→'none'/book→'book'/house→'house'; sophiaShare = full for house, ×0.75 for producer accounts, matching `sophiaRowFor`), `priorAcctTag(it)`.
- Woven into: `computeSheetTotals` (broker+comm+sophiaShare for Sophia; payout for producer), `sheetPolicyRecords` (concat for open sheets → feeds KPIs + agency report + producer breakdown), close snapshot (`closePaySheet` appends prior records so closed KPIs retain them), `renderSheetBody` Sophia + producer branches (prior rows render inside the same account-kind groups, alphabetical, flagged with a "prior" tag + diagonal-hatch row bg; group counts include them), shared empty-guard.
- **UI:** admin-only "Prior items" bar on the Pay Sheets page — **⬇ Import June 2026 Excel items** (idempotent: re-import replaces; never touches the 51 system policies or chargebacks) + **Remove imported items** + status line. `importJune2026PriorItems()` / `removeJune2026PriorItems()` / `updateImportBar()` (called in `renderPaySheets`). Importer ensures Kaylee's producer sheet exists so her items render.
- **Dates:** Sophia wants checks/ACH commission dates always `00/00/0000` (MM/DD/YYYY) — existing `toSlashDate` already normalizes the Checks/ACH + chargeback date inputs to that format; prior items carry no per-item date from the Excel (left blank).
- **Verified live:** import → 59 items (47/4/8), Sophia totals +$32,881.66 broker / +$18,378.68 comm (existing 51 untouched), Kaylee sheet +$2,166.48 payout, 59 prior records flow to KPI `sheetPolicyRecords`, rows render in-group with "prior" tags, no console errors. Test import then removed so Sophia applies it herself via the button (browser-storage: the data must be written in her session).
- **NOTE / browser-storage caveat:** because the prototype stores data per-browser, the import runs in Sophia's own session via the button (one click). In the live build this would be a server-side migration.

**Pay-sheet sections sorted alphabetically with prior items interleaved (June 28, 2026).** Follow-up: Sophia liked the hatched-background distinction for imported items and asked that each section be alphabetical so an imported account sits next to a matching existing one (easy duplicate-spotting) while still visibly marked as imported. Changed both `renderSheetBody` branches (Sophia + producer): instead of appending prior rows after the txn-clustered policy rows, policies + prior items are merged into one `_rows` array of `{insured, html}` and sorted alphabetically by insured, then rendered. This replaced the prior per-section txn-clustering with a single A–Z order across the whole section. Verified: House section renders 80 rows fully alphabetical, imported (hatched) and existing interleaved — immediately surfaced likely dupes (imported "All Honor Construction LLC" beside existing "All Honor Construction, LLC"; "ASAP Pro Painting" twice).

## June 28, 2026 — Pay Sheets restore point (revert safety net)

**Pay Sheet restore point (June 28, 2026, admin-only — Pay Sheets is admin-only).** Sophia wanted to snapshot the pay-sheet data as it stands now so that if a next step changes things she can revert to exactly what the pay sheets currently reflect. A pay sheet's content is determined by BOTH `paySheets[]` (which policies/adjustments/deposits sit on which sheet, closed-sheet snapshots, rateSnapshots) AND the `ledger` (open sheets compute live from each entry's `mgaPaid`/`paidAt`/`commission`), so the restore point captures **both**.
- New bar at the top of the Pay Sheets page (under the Print bar): **💾 Save restore point** + **↩ Revert to restore point** + a status line showing when the current point was saved and its size (paid-policy count + sheet count). Hidden during print.
- `PS_RESTORE_KEY='wcib_v9_paysheet_restorepoint'`; `savePaySheetRestorePoint()` deep-copies paySheets+ledger with a timestamp (confirms before overwriting an existing point); `restorePaySheetRestorePoint()` confirms, restores both arrays, re-persists (`persistPaySheets`/`persistLedger`), and refreshes Ledger/MGA/Pay Sheets/badges/pill strip; `updateRestorePointBar()` runs inside `renderPaySheets`.
- **Single named point**, kept in localStorage: saving again overwrites it; reverting keeps it (so you can re-save after). Not wiped by the normal persist set.
- Verified: save at 51 paid policies → flipped one paid→unpaid (50) → revert restored to 51, the exact policy paid again, persisted to localStorage; restore point survives the revert; revert button disabled until a point exists.
- NOTE for engineer handoff: this is a single in-browser restore point (same storage model as the rest of the prototype). A live build could keep multiple named/dated restore points server-side; the existing full file Backup/Restore (Settings) remains the broader cross-device option.

## June 28, 2026 — MGA Payables: highlight Net due + show exact commission

**Net due highlighted + exact commission surfaced on MGA Payables (June 28, 2026, admin-only).** Sophia: when on this screen the number she's really looking at is Net due — make it pop — and she also needs the exact commission amount (the column was combining commission + broker fee).
- **Net due band:** new `.mga-net` class — light navy band (`--navy-light`), bold, ~1rem, on each net cell so the column reads instantly as the key figure; paid rows use the green `--ok-bg` band; header "Net due" gets a solid navy chip (`.mga-hdr-net`). Value color navy (unpaid) / green (paid).
- **Commission split out:** the "Comm+Fee" column (was `fmt(c+brokerFee)`) is now **"Commission"** showing the exact commission `fmt(c)` + its rate label, with a small "+ $X broker fee" subline beneath when a broker fee exists. Net = collected − commission − broker fee, so both deductions remain visible.
- Display-only. Verified: header Collected · Commission · Net due; commission shows exact $ + rate + fee subline; net cell carries the band.

## June 28, 2026 — Audit/Endorsement: invoice language (not "proposal/quote")

**Audit & Endorsement turn-ins relabel to "invoiced amount" language (June 28, 2026, all logins).** Sophia: for Audit/Endorsement, the document we look at is the WCIB invoice we sent the insured, not a proposal/quote — so the wording must say "invoiced," not "proposal." Driven by the existing `isInvoiceTxn(val)` in `onTxnTypeChange` (already relabeled the proposal-check field); extended to relabel, for invoice txns (reverts for New/Renewal/Rewrite/Cross-sale):
- **Section label** (`#proposal-sec-label`): "Proposal total — verify against the quote" → "WCIB invoiced amount — verify against the invoice".
- **Deposit-option field** (`#m-depositoption-label`): "Deposit option from quote" → "Deposit option from carrier"; hint (`#m-depositoption-hint`) drops the proposal reference → "Deposit option from the carrier — if a balance will be financed" (kept, since a financed balance can still occur).
- **Premium-detail total** (`#m-proposaltotal-label`): "Proposal total (incl. broker fee)" → "WCIB Invoiced Total".
- **PDF** (`buildTurnInPrintDoc`): `invTxn=isInvoiceTxn(f.txntype)` → the "Proposal total" row prints as "WCIB Invoiced Total" and "Deposit option (from quote)" as "Deposit option (from carrier)" for invoice txns. (Extended to the PDF for consistency with the on-screen wording.)
- Verified: Audit & Endorsement show invoice wording across section/check/deposit/premium-total + PDF; Renewal reverts to proposal/quote wording.

## June 28, 2026 — Turn-in PDF: Net due to MGA distinct highlight

**Net due to MGA highlighted in its own color on the Check Turn-In PDF (June 28, 2026, all logins).** Sophia wanted Net due to MGA marked in a different color from the other highlighted (financed) figures. Added `.tp-hi2` print style (green `#bfe9cf`, print-color-exact) alongside the existing `.tp-hi` (yellow `#fff3a8`, used for the financed cross-ref figures: Proposal total, Amount collected, Balance financed). New `rHi2` row builder in `buildTurnInPrintDoc`; the "Net due to MGA" row now uses `rHi2` (always, not just financed). Verified: Net-due row carries class `tp-hi2` / green bg; the three financed rows stay `tp-hi` / yellow; Net due is the only green row.

## June 28, 2026 — Commission review gate before Payment type

**Forced commission-amount confirmation before continuing (June 28, 2026, all logins).** Sophia: the commission amount populates off the base premium, and she wants whoever submits to consciously go back to the carrier invoice and confirm it's right before reaching Payment type — to catch bad premium-detail entries. Built a required checkpoint at the end of the **Premium detail** section (which sits right before Payment type): a checkbox "Confirm the commission amount ($X) matches the carrier invoice" that shows the live computed commission and **gates submission**.
- Shows only when there's an actual commission to verify — `commMode==='pct' && base>0`. Hidden for TBD (carrier pays later) and N/A (broker fee only); not required in those modes.
- **Auto-unchecks if the amount later changes:** `_commConfirmedAmt` stores the value confirmed; in `mCalc`, if the recomputed commission differs by >0.005 it clears the check and shows "Commission changed — please re-check it against the invoice." So editing base premium / commission % after confirming forces re-verification (the core anti-bad-data intent).
- **Validation (`mValidate`):** when pct + base>0 and unchecked → blocks submit with a clickable jump-to-field error.
- Persisted as `commConfirmed` (snapshot, both ledger-entry builders) and restored in `loadSnapshotIntoForm` (recomputes `_commConfirmedAmt` so a confirmed draft stays confirmed). Reset/cleared in `resetFormState` + `clearFormDOM`. Corrections (`openLedgerInForm`) of legacy entries default unchecked → re-confirm after editing (intended). Handler `onCommConfirm()`.
- Verified live: row appears with $150 (base 1000 @ 15%), check holds, base→2000 auto-unchecks with the re-check hint, hidden for TBD.

## June 28, 2026 — MGA Payables: Account column

**Account column added to MGA Payables (June 28, 2026, admin-only).** Sophia wanted to see whose account each policy is on the MGA Payables page. Added an "Account" column right after Insured in each MGA card's policy table, using the existing `acctTagHTML(p)` chip (same as the Policy Ledger): **House** / **{Producer} · book** / **{Producer} · 1st Year**. Updated both `.mga-pol-row-hdr` and `.mga-pol-row` grid-template-columns to 8 columns (`32px 1.8fr 1.1fr 1fr .8fr .8fr .8fr 1.4fr`), added the header `<span>Account</span>`, and the per-row `<span>${acctTagHTML(p)}</span>`. View-only. Verified: header + 8 cells per row, chips render House / Kaylee · book / 1st Year correctly.

## June 28, 2026 — MGA Payables alphabetical within each category

**MGA Payables policies sorted alphabetically by insured within each MGA category (June 28, 2026, admin-only).** Sophia asked for alpha order per MGA. In `renderMGA`, after the per-card filter, `visiblePols.sort((a,b)=>(a.insured||'').localeCompare(b.insured||''))`. The MGA category cards themselves were already alphabetical (`Object.keys(groups).sort()`). View-only sort — touches no data. Verified live: BTIS (13), Bass (1), CNA (20), HCC (1) all render insureds in order.

## June 28, 2026 — Turn-in field flow: Policy info slimmed + new Carrier-invoice section

**Check-in fields regrouped to match the physical paperwork (June 28, 2026, all logins).** Sophia, flow rationale: Policy information should hold only what she identifies the account by; the carrier-invoice data (carrier, MGA, dates, commission) should cluster together right before Commission since she reads them all off the carrier invoice at once.
- **Policy information** now = Insured name, **Company name** (kept — DBA tied to the insured; Sophia listed insured/policy type/transaction but Company is an optional identity field with no better home, so left under insured), Policy type, Transaction type (+ its rewrite-subtype + notes/invoice rows).
- **NEW section "Carrier invoice — insurance company, MGA, policy # & dates"** inserted **after Amount collected, before Commission**, holding the moved fields: Insurance company, MGA, Policy #, Effective date, Expiration date (all off the carrier invoice; Commission follows, also off the invoice).
- Resulting section order: Account assignment → Policy information → Proposal total → Amount collected → **Carrier invoice** → Commission → Premium detail → Payment type → Net due to MGA → General notes.
- **Pure markup move** — every field ID (`m-polnum`/`m-effdate`/`m-expdate`/`m-insco`+`m-insco-input`/`m-mga`+`m-mga-input` and their dropdown/hidden siblings) is unchanged and now appears exactly once; mCalc/validation/snapshot/combos all work by ID regardless of DOM position. Verified live: order correct, no duplicate IDs, insco/MGA type-aheads + selectInsco + autoExpiry (annual-poltype gated) all still function.

## June 28, 2026 — Ledger duplicate detection (admin safeguard)

**Policy Ledger flags possible duplicate entries (June 28, 2026, admin-only — ledger is admin-only).** Sophia: catch accidental double-entries so the same policy isn't pushed/settled twice. Detection in `renderLedger`: an entry is a **possible duplicate** when another ledger entry shares the same **insured name AND policy #** (both present, normalized case/whitespace via `_dupKey`); if the **accounting also matches** (base + broker fee + collected, via `_acctKey`) it's upgraded to **Likely**.
- **Per-row badge** on the insured cell: amber "⚠ Possible duplicate" / red "⚠ Likely duplicate" (+ "×N" when a group is >2), with a tooltip to verify before settling.
- **Banner above the table** when any duplicates exist: "⚠ N possible duplicate rows across M insured/policy matches…" with a **Show only duplicates / Show all** toggle.
- **"⚠ Duplicates" filter button** in the Show row (hidden when none exist) — `ledgerDupOnly` state, `setLedgerDupOnly(v?)` toggles; composes with the existing finance filters/search/sort. Auto-resets to false when no duplicates remain.
- Pure detection/display — touches no data, money, or settlement state. Computed over the full `ledger` each render so it stays live as entries change. Verified: 3 same insured+polnum rows → banner + filter appear, two matching-accounting rows badge "Likely ×3", the differing one badges "Possible ×3", dup-only filter shows just those 3 (test rows non-persisted, cleaned up).
- NOTE / possible follow-up offered to Sophia: this flags duplicates AFTER they're in the ledger. The double-push itself happens at **Approvals** — a pre-push warning there (checking a pending submission against the ledger for same insured+polnum) would catch it before it ever lands. Not built yet; mentioned as an add-on.

## June 28, 2026 — Rewrite sub-type (Coverage vs Won-back) + win-back KPIs

**Rewrite transaction split into Coverage vs Won-back for KPI insight (June 28, 2026; form all logins, KPI split admin-only).** Sophia wants to distinguish two kinds of rewrite: a **true/coverage rewrite** (moved Carrier A→B for a coverage reason — client was retained) vs a **won-back** (a previously lost client coming back, "new business coming back to us that we rewrote in the past"). Goal: admin KPIs that show which clients are returning that we'd lost.
- **Form:** kept the single `Rewrite` transaction type; when it's selected, a sub-toggle row (`#rewrite-subtype-row`) appears — **Coverage rewrite — carrier change** / **Won back — previously lost client**. State `rewriteType` ('' | 'coverage' | 'wonback'), setter `setRewriteType`. Shown/hidden + reset in `onTxnTypeChange` (cleared whenever txn ≠ Rewrite). **Required** when txn=Rewrite (mValidate). Chose a sub-toggle over two separate dropdown types so all existing Rewrite plumbing (rates → Renewal, chip color, TXN_ORDER, pay-sheet grouping) stays untouched — zero risk to commission math.
- **Persistence:** `rewriteType` in `formSnapshot`/`loadSnapshotIntoForm` (+ button-class restore after onTxnTypeChange), both ledger-entry builders (only when txn=Rewrite, else ''), and BOTH pay-sheet record builders (`sheetPolicyRecords` variants) so it reaches KPIs.
- **Admin KPIs:** (1) `kpiTxnTypeHTML` now splits the Rewrite card into **Rewrite · COVERAGE** and **Rewrite · WON BACK** (legacy rewrites with no sub-type fall into COVERAGE — the historical "true rewrite" meaning). (2) New **"Won-back clients"** card in the "New business vs. retention" section showing count + revenue of won-back rewrites, so Sophia can track recaptured clients at a glance.
- **Rates unchanged:** both rewrite kinds still use Renewal commission rates exactly as before. (Open question flagged to Sophia, not assumed: whether a won-back should ever earn NEW rates — left as-is until she says otherwise.)
- Verified live: sub-toggle hidden for non-Rewrite, shown for Rewrite, won-back selectable, cleared on switch-away; KPI split renders Coverage=3 (incl. legacy)/Won-back=1 on synthetic data; won-back retention card maps correctly.

## FUTURE INTEGRATION NOTES (not built — for the engineer handoff). AgencyZoom (upstream) + NowCerts (downstream).
**Context:** This dashboard is a self-contained browser app (localStorage, no backend). Sophia will hand it to an engineer to make live for the company. She's accumulating integration requirements; live API wiring is the engineer's phase, NOT something to build into this artifact now. (June 28, 2026.)

**AgencyZoom (the step BEFORE a check turn-in) — corrected understanding:**
- AgencyZoom **never creates a check turn-in** (an earlier assumption in conversation was wrong — do not build on it). When a lead is marked **Sold**, AgencyZoom shows a "policy sold" modal that captures: Primary/Other Producer, Primary/Other CSR, Lead Source, Policy Tags, **Carrier/Writing Company**, **Policy** (type, e.g. General Liability), **Policy #**, **Broker Fees**, **Premium $**, **Revenue**, **Items**, **Effective Date**, **Expiration Date**, **Sold Date**. (Screenshots: `uploads/pasted-1782669177758-0.png`, `uploads/pasted-1782669193427-0.png`.)
- That data creates a **policy line item inside AgencyZoom for KPI tracking only**. AgencyZoom does **NOT** push anything to NowCerts. NowCerts entry is done manually today.
- **Renewals:** same flow but AgencyZoom asks for less info → more manual on WCIB's end to record in NowCerts.

**NowCerts (the step AFTER a turn-in is created & financed) — what Sophia DOES want automated:**
- Auto-populate the NowCerts policy with the **objective / supportive fields**: **policy number, effective date, expiration date, MGA, policy type, insurance carrier**, plus the **accounting** (premiums/fees). Then a human **verifies for accuracy and adds the judgment fields no system holds** — **policy limits, deductibles** — so it cross-references with the certificate in NowCerts.
- **Limits & deductibles stay MANUAL** — neither AgencyZoom nor this dashboard captures them. Expected; fine for now.
- By transaction type: **renewal** → go to the policy, mark renewed + enter new-term data; **new business / bind** → create a brand-new policy; **invoice / audit** → the accounting section of the existing/audited policy.

**Engineer note:** AgencyZoom's Sold modal and WCIB's check turn-in capture overlapping objective fields (carrier, policy type, policy #, broker fee, premium, eff/exp dates) → two clean datasets that could each feed NowCerts. Decide the **source of truth per field** to avoid conflicts; the WCIB dashboard is the stronger candidate (it already enforces clean, structured accounting). Build approach when live: middleware/webhook layer between systems; this dashboard provides the clean data contract (its IPFS finance export is the existing precedent for a structured downstream export).

---

**Sort + search + anti-print lock added to producer "My Commissions" (June 28, 2026, producer logins only).** Sophia asked for the same sort/search affordances the admin Policy Ledger has, plus print protection.
- **Sort bar** (mirrors `.ledger-sortbar` styling): **Insured A–Z** (default, auto-applied) and **Account**. Account sort groups their book business by policy type with their 1st-year house items last (`acctKey`). State in `myCommSort`, setter `setMyCommSort` re-renders.
- **Search box** (mirrors `.ledger-searchbar`): live insured-name filter across all three sections, Escape/✕ to clear. State `myCommSearch`, setter `setMyCommSearch` re-renders and restores caret/focus. Section count badges show the FULL section size; a "No matches in this section" line shows when a section has items but none match. **Totals (Owed/Paid/owed-header) are always computed from the full sets** — search/sort never changes what they're owed.
- **Anti-print confidentiality lock** (`mcBeforePrint`/`mcAfterPrint` on window `beforeprint`/`afterprint`, plus a Ctrl/Cmd+P keydown catch): on print, insured names are live-scrambled to █ blocks and amounts masked to ███; an `@media print` CSS rule (the hard backstop, runs even if JS is blocked) hides the real rows/summary/controls and shows a "🔒 Confidential — commission information cannot be printed" notice. **Scoped strictly to `#page-mycommissions.active`** so the admin Policy Ledger and the turn-in PDF export are completely unaffected. Caveat noted in code + to Sophia: a browser app can't technically stop screenshots; this blocks the easy print/PDF path, and a live build can add server-side watermarking/DLP on top. Verified live (Kaylee): A–Z default, search→2 LDN results with owed unchanged at $953.56, account sort toggles, scramble masks then restores cleanly.

**Delete option added to Approvals (admin-only) (June 28, 2026).** Sophia asked for the same delete affordance the policy ledger has, but on the Approvals queue — for an accidental duplicate submission, or an insured that cancelled before being moved forward but already submitted to her. New `deleteQueueEntry(id)` + a "✕ Delete submission" button in each pending card's `.approval-actions` row (reuses `.led-act-btn.del` ghost-destructive styling, `margin-left:auto` to separate it from the prominent Send back button). Behavior: confirm → discards the linked draft from its owner's bucket (so it doesn't dangle as "submitted" in the employee's account) → removes the queue entry → `persistQueue`/`persistDrafts` → re-render + badge update. **Distinct from Send back** (which returns it to the submitter to edit) — Delete throws it away entirely. **Never touches the ledger** — a pending approval isn't in the ledger yet (that's what `deleteLedgerEntry` is for). Admin-only because the Approvals page is admin-only.

## June 27, 2026 — Account assignment moved to FIRST on the turn-in form

Follow-up to the June 26 reorder: the `#agent-section` (Account assignment, employees) was sitting *after* the Policy-information section, so Policy information rendered first. Sophia: "the account assignment is not the first thing on the check turn in, the policy information is." Moved `#agent-section` up to immediately after the admin `#admin-kaylee-section` block (the two account-assignment variants now sit together at the very top; only one is ever visible per role) and before `#office-field` + Policy information. Resulting visible employee flow: **Account assignment → (Office location, multi-office only) → Policy information → Proposal total (+Deposit option) → Amount collected → Commission → Premium detail → Payment type → Net due to MGA → General notes.** Pure markup move; no IDs/handlers changed.

## June 26, 2026 session — check turn-in flow reorder (physical-file order) + deposit-option field

**Check turn-in sections reordered to match the physical paperwork order (June 26, 2026, all logins).** Sophia's reasoning: when she opens a file she works it in a fixed order — CRM (whose account) → the proposal on the physical file (total + deposit) → the payment collected → the carrier's invoice (commission) → the binding docs (itemized premiums). The form should mirror that. **New section order** (was: Account → Premium → Commission → Payment type → Proposal verify → Amount collected [w/ net due + finance block] → Notes):
1. **Account assignment** (unchanged, already first)
2. **Proposal total — verify against the quote** (+ the new Deposit option field, below)
3. **Amount collected — from ePayPolicy receipt** (just `m-amtpaid` + its hint now)
4. **Commission**
5. **Premium detail — from carrier invoice & binding docs**
6. **Payment type** — the finance/IPFS block (`m-finance-row` incl. balance financed, finance conf #, IPFS Yes/No, contact fields, manual toggle) AND the direct-bill note (`m-direct-row`) **moved here** from the old Amount-collected section, per Sophia: "if it's financed and we hit payment type as finance, continue with what we built for the financing element; if not financed, keep moving."
7. **Net due to MGA** — its own final section now (`m-netdue` moved out of Amount collected)
8. General notes
- **Pure layout reorder of existing markup** — every ID/handler is unchanged, so `mCalc`/`mValidate`/`setPayMode`/`formSnapshot`/etc. all work by-ID regardless of DOM position. `setPayMode` still shows/hides `m-finance-row`/`m-direct-row` by ID. The finance math is reachable because Amount collected (step 3) is entered before Payment type (step 6).
- **Proposal-now-before-premium guards (important):** the broker-fee cross-check needs the premium (entered later now). To avoid the premature-red-flag problem Sophia disliked before: (a) `mCalc` broker-verification box shows a NEUTRAL "Waiting on premium detail below to verify" when proposal is entered but base isn't (instead of red "⚠ Required"); (b) `mValidate` only runs the broker-fee-mismatch error when `base>0` (premium still separately required, so submit stays blocked until premium is in — just no false "doesn't match" while premium is empty).

**New "Deposit option from quote" field — INFORMATIONAL ONLY (June 26, 2026, all logins).** `m-depositoption`, sits beside the Proposal total in section 2. Sophia confirmed THREE times: it does NOTHING in the math; the deposit/financing math + IPFS export keep using **Amount collected from ePayPolicy (`m-amtpaid`)** exactly as before. The field exists purely "from a flow standpoint to help the agent put in information" — the agent reads the quote's total + its deposit option together. On paid-in-full/direct it's just captured info. Still persisted so it's part of the record: added to `formSnapshot` (`depositOption`), `loadSnapshotIntoForm`, `draftHasContent` fields, BOTH ledger entry builders (live-submit `depositOption:v('m-depositoption')`; approve-from-draft `depositOption:+f.depositOption||0`), and the PDF turn-in (a "Deposit option (from quote)" row, shown only when >0). Cleared automatically by `clearFormDOM` (it clears all number inputs). **No tweak/toggle reads it — do not wire it into any calc.**
- Backup before this work: `backups/wcib_dashboard_v14_2026-06-26_pre-flow-reorder.html`.

**Producer-facing commission tracker — "My Commissions" tab (June 26, 2026, producer logins only).** Built per Sophia. Producers log in through the employee login (`currentRole==='employee'`, staff `role==='producer'`); they previously saw only Check Turn-In + My Items and had NO payout visibility in their own login (all pay-sheet data was admin-only). `buildNav` now appends a **My Commissions** tab when `staffList.find(name).role==='producer'` (Mercedes/other employees never see it; admin unaffected — Sophia explicitly wanted nothing changed on her side). New `#page-mycommissions` + `renderMyCommissions()`:
- **Three sections** — **Awaiting payment** (ledger entries assigned to me, not yet marked paid), **In review** (pending `queueEntries` on my account — items others or I submitted, awaiting Sophia), **Paid** — plus a 3-card summary (Owed to you / Paid · last 30 days / In review count) and the owed figure in the page header.
- **"Assigned to me"** = `producer===currentUser && (kaylee==='book' || kaylee==='house')` — covers both their book and their 1st-year house. House/agency (`kaylee==='none'`) excluded.
- **Shows ONLY their own money + minimal ID:** insured name, policy-type chip, transaction chip, and **their payout amount** (`prodPayoutForEntry` → `producerPayoutFor` with the producer's open sheet / today's rate, or the closed sheet's snapshot rate if the policy is on one). Deliberately **omitted** (Sophia's anti-poaching ask): policy #, effective date, carrier/MGA, contact info, premium breakdown. **No print/export anywhere on the page.** In-review amounts show a `~` prefix (estimate, not final).
- **Producer marks paid themselves** — `toggleProdPaid(policyId)` sets/clears `prodPaidAt` (ISO) on the ledger entry, guarded so only the producer who owns the entry can toggle (and only a producer role). Un-checkable (Undo). Persists via `persistLedger` (shared storage → carries across logins). Touches NO money math / pay sheets / agency financials — it's purely the producer's checklist. **`prodPaidAt` added to the admin-Correction keep-list** so a ledger correction doesn't wipe a producer's paid mark.
- **30-day retention on the Paid section (`PROD_PAID_RETENTION_DAYS=30`):** a paid item shows only while `prodPaidAt` is within 30 days, then **drops off the producer's view** so a full insured list can't accumulate for poaching if they leave. This is **access-expiry, not deletion** — the underlying ledger row stays intact in Sophia's admin; only the producer's visibility ends. (Note in the UI: "Paid items stay here for 30 days, then drop off automatically.")
- **Verified live (Kaylee):** tab appears, 3 sections render, $732.06 owed across 10 awaiting items + 2 in review + 0 paid; Mark paid drops owed to $710.18 and shows the green ✓ Paid badge, Undo restores $732.06. No console errors. (Decision recap of the Q&A: producer-marked only — NOT auto on pay-sheet close; show their payout $; un-check allowed; no policy #/eff date; 30-day window.)

---

## June 25, 2026 session (`wcib_dashboard_v14.html`) — data merge, budget confirm, turn-in fixes, invoice mode

- **"Finance manually" toggle + Record ID column + pending-only automation export (June 26, 2026).**
  - **Manual finance flag (all logins).** In the IPFS contact block (financed + IPFS=yes), a checkbox "Finance this manually — special/approval agreement" (`m-ipfs-manual`, module var `ipfsManual`, `setIpfsManual`). When checked, the 4 contact fields become OPTIONAL (validation skips them) and the policy is EXCLUDED from the automation export — for weird agreements needing special approval that a human keys into IPFS. Wired through snapshot/restore, both ledger builders (`ipfsManual` stored only when deposit+IPFS), resets (resetFormState + clearForm block, incl. unchecking the box). Ledger badge shows gray "💰 IPFS manual"; detail shows "Finance handling: Manual — excluded from automation".
  - **Record ID column** = the entry's internal `id`, first column of the export — stable key so the automation can dedupe and write status back (the future round-trip that would auto-flip `ipfsPushed`).
  - **Export scope = automation work queue.** `exportLedgerCSV` now exports IPFS-financed policies that are NOT pushed-through AND NOT manual (was: all IPFS-financed). Rationale (explained to Sophia): the export feeds the automation, so it should only contain what the automation should act on — sending already-done (pushed) or manual ones risks duplicate IPFS quotes. Final v15 has 47 columns; verified 13 exported = 15 IPFS − 1 pushed − 1 manual.
  - **Resolved with Sophia:** SAIF uses literal "General Liability" (the snip's GLPL was a coverage they don't write). Still TODO: full coverage-name→IPFS-code list + carrier/MGA preferred-list name mapping (Sophia to provide). IPFS terms never change (interval/pymt#/dates standard → automation hardcodes). Existing financed data is throwaway (parallel old system); real integration happens after an engineer moves this to a shared multi-user system. Address stays one field for now (automation parses Street, City, State ZIP).

- **IPFS Section 3 (Program) constants added to export (June 26, 2026).** Snip of IPFS Program section: Billing Type always Invoice, Loan Type Commercial, Program Name WESTCOAST, and the two bottom toggles **All Tax In Down: No** and **Doc Stamp: No**. Added export columns `IPFS Program Name`='WESTCOAST', `IPFS All Tax In Down`='No', `IPFS Doc Stamp`='No' alongside the existing Billing/Loan type. Rate/Fee Rate (WEST COAST SELL RATES 11.23 / BASE 11.23 SPRD) auto-fill from the program selection — not exported. 45 columns total now.

- **Export realigned to the IPFS quoting form + pending/completed filters (June 25–26, 2026).** Sophia sent snips of the IPFS quoting app (`westcoastinsurancebrok.ipfs.com/.../quotingapp`, sections 4 Policies + 5 Underwriting). Confirmed field mapping from a filled example (Premium $5,000 / Taxes $500 / Fees $500 / Total $6,000 / Down $1,050 / Min Earned 0 / Cancel 10 / Amt Fin'd $4,950). KEY rules: IPFS shows ONE "Fees" line (= broker fee + MGA fee combined), and section 5 Underwriting has a Broker Fee field that must stay $0.00 (so the financed amount isn't thrown off). **CSV columns rewritten to mirror the form 1:1**, automation-target columns prefixed `IPFS …`: Policy # (→'PENDING'), Coverage, Company (carrier), General Agent (MGA), Eff/Exp, Premium(=base), Taxes, **Fees (Broker+MGA combined)**, Total Premium(=proposalTotal), Min Earned % 0.000, Min Earned $ 0.00, Down $(=amtPaid), Cancel Days 10, Billing type Invoice, Loan type Commercial, **Underwriting Broker Fee (ALWAYS 0)**, Contact name/phone(mobile)/email + Insured mailing address (insured contact section), plus Insured (business name). WCIB-internal columns suffixed "(WCIB internal)". 42 cols, verified Papaya: Premium 515 / Fees 550 / Broker-0 0.00. Billing/loan/min-earned hardcoded constants for all IPFS rows. **Pending/completed filters:** ledger "Show" = All / 💰 Financed / IPFS pending / IPFS completed (`ledgerFinanceFilter` 'all'|'financed'|'pending'|'completed'); pending=`isIpfsFinanced && !ipfsPushed`, completed=pushed. **OPEN design questions raised to Sophia (see chat):** (1) coverage-code mapping — our poltype "General Liability" vs IPFS code "GLPL"; (2) carrier/MGA names must match IPFS preferred-list spelling; (3) add stable policy `id` column + pending-only export for clean write-back/no re-processing; (4) legacy/merged financed rows predate contact capture → blank contacts; (5) confirm IPFS terms (interval MONTHLY / Pymt# 10 / first-pmt date) are standard.

- **"Pushed through to IPFS" status + IPFS-only export (June 25, 2026).** Answers Sophia's "how would I know they've been pushed through." Since the IPFS-agreement automation runs on a SEPARATE platform, the dependable signal is a status on each financed policy. Added `ipfsPushed` (bool) + `ipfsPushedAt` (date) to ledger entries (both builders; preserved through a Correction via the `Object.assign` keep-list). `toggleIpfsPushed(id)` flips it (admin, in the ledger detail panel: "Mark pushed through to IPFS" ↔ "✓ Pushed through · date"). Row badge `finBadgeHTML(p)` now shows **💰 IPFS pending** (amber) until marked, **💰 IPFS ✓** (green) once pushed, or **💰 Financed** for non-IPFS. `isIpfsFinanced(p)` = `payMode==='deposit' && ipfsFinanced!=='no'` (legacy financed rows default to IPFS). **CSV scope changed:** `exportLedgerCSV` now exports ONLY IPFS-financed policies (per Sophia), filename `WCIB_IPFS_Financed_<date>.csv`, button relabeled "⬇ Export IPFS CSV"; added "Pushed through to IPFS" + "Pushed date" columns (42 total) so the automation can skip already-sent ones. Verified: 14 IPFS-financed exported, mark/undo persists. **Round-trip note for future:** if the two systems are ever connected, the automation could flip `ipfsPushed` automatically on write-back; until then it's a manual mark (reliable baseline). IPFS confirmed = Imperial Premium Financing Services (same company).

**IPFS finance integration support — conditional contact fields + ledger CSV export + financed filter (June 25, 2026).** Context: Sophia is building an automation on another platform that will take this dashboard's data and create IPFS (Imperial Premium Finance) finance-agreement quotes. NOTE: "IPFS" = "Imperial Premium Finance" (IPFS Corp, formerly Imperial PFS) — same company; relabeled the form's old "Imperial Premium Finance"/"Imperial finance confirmation #" to neutral "Balance to be financed"/"Finance confirmation #" since financing isn't always IPFS now. Backup taken first: `backups/wcib_dashboard_v14_pre-ipfs-finance.html`.

- **Conditional IPFS contact fields on financed check-ins (all logins).** When Payment type = "Deposit — financed", a new required toggle **"Financed with IPFS (Imperial Premium Finance)?"** appears (`setIpfsFinanced('yes'|'no')`, module var `ipfsFinanced`), defaulting to **Yes** (common case; first deposit-select sets it). **Yes** reveals 4 required fields IPFS needs for the quote — **Contact name, Mobile number, Email address, Mailing address** (`m-fin-name/mobile/email/address`, in `#m-ipfs-contact`) — plus a note that IPFS quote defaults (billing type Invoice, loan type Commercial, no minimum earned) are applied automatically. **No** = financed elsewhere, fields hidden/not required. Wired through: form HTML (in `#m-finance-row`), `setPayMode` (reflects toggle+visibility), `mValidate` (requires the answer when deposit; requires the 4 contacts when IPFS=yes — all clickable jump-errors), `formSnapshot`/`loadDraftToForm` (persist+restore `ipfsFinanced` + 4 contacts), BOTH ledger builders (live-form ~3720 + approve-from-draft ~3550), and resets (`resetFormState`, `clearForm` block, `clearFormDOM` selector broadened to include `tel`/`email`). Ledger entries now store `financeRef`, `ipfsFinanced`, `financeContact{name,mobile,email,address}`, and `financeMeta{billingType:'invoice',loanType:'commercial',minEarnedPct:null,minEarnedAmt:null}` (the integration's IPFS constants; null = "leave blank on IPFS"). Detail panel shows Financed via / Finance confirmation # / IPFS contact. Old pre-feature financed rows have blank contacts and default to "IPFS" display (ipfsFinanced!=='no') — acceptable.
- **Ledger CSV export (admin-only).** "⬇ Export CSV" button on the Policy Ledger header → `exportLedgerCSV()` downloads `WCIB_Policy_Ledger_<date>.csv`. 40 columns, **plain numbers** (`.toFixed(2)`, no $/commas — clean for import), fees **itemized** (base/taxes/MGA fee/broker fee) AND a **"Fees combined (MGA+broker)"** column for IPFS's single fee line. Includes all finance/IPFS/contact fields, account label, 25/75 splits, approved date, MGA-paid. Exports ALL policies (ignores on-screen search/finance filter — predictable full dataset). UTF-8 BOM + RFC-4180 quote escaping. Read-only, zero storage impact. Verified: 106 rows = ledger length, commas escaped.
- **Financed vs non-financed view (admin-only).** Ledger sortbar gained a "Show: All / 💰 Financed only" filter (`ledgerFinanceFilter`, `setLedgerFinanceFilter`) — financed = `payMode==='deposit'`. Each financed row shows a small "💰 Fin" badge. Lets Sophia pull up just financed accounts to confirm each was pushed through. Verified: 14 financed of 106, badge on all 14.
- **OPEN / pondered — financing two policies (two carriers) under one IPFS agreement (Sophia's #3, NOT built).** Rare case. Recommendation pending discussion: keep two separate check-ins/ledger entries (each its own carrier+accounting) linked by a shared finance confirmation #, OR a "multiple policies, one finance agreement" button that chains a second check-in and back-links them. To revisit.

**Blank draft no longer LISTED in My Items either (June 25, 2026, all logins).** Follow-up to lazy draft saving. Sophia: opening a check-in then going straight to Drafts (without typing) showed a draft there. Root cause: it was NOT persisted to storage (the lazy-save fix already prevented that), but `renderMyItems` listed it via the clause `... || d.id === activeDraftId`, so the still-open blank active draft appeared in the list (while the count + total already excluded it — inconsistent). Fix: dropped the `|| d.id === activeDraftId` clause — the My Items list now shows a draft only once `draftHasContent` is true. Confirmed across logins (shared functions, login-agnostic): login→opens blank active draft = 0 stored, not listed; visiting Drafts = still nothing; typing ANY one field (e.g. insured) → persists + appears in the list. So a draft is created only when something is manually entered, everywhere.

**Policy Ledger detail panel — show the financed amount + every stored field (June 25, 2026).** Sophia: (1) financed accounts should show the amount financed; (2) anything else the ledger stores that wasn't on the expand should now show. Rebuilt the expandable detail panel (`renderLedger`) to surface all meaningful stored fields via two helpers — `_F(label,val,style)` (short field, omitted when blank/null) and `_FW(...)` (full-width row for long text). Fields now shown (empties auto-omitted): Transaction, **Carrier (insco)**, **Invoice #**, Eff date, **Exp date**, **Office** (resolved from `officeId` via `propertyList`), **Company**, **Base premium**, **Taxes** (if >0), **MGA fee** (if >0), Broker fee, Commission (+%), Comm+Fee, **Proposal total** (if >0), Collected, **Financed** (deposit only — `financeBalance`, fallback `proposalTotal−amtPaid`, purple), **Net due to MGA**, **Payment type** (full/deposit/direct label), Producer 25%, Sophia 75%, Submitted by, **Approved** (date), **MGA paid** (`mgaPayRef` + `paidAt`), **Transaction notes**, **General notes**, **Override reason** (if overridden). Verified on a real financed entry: Financed $437 = proposal $1,065 − collected $628; 19 fields shown, dates valid, blanks omitted. Internal-only fields (id, submittedById, agent, onPaySheets, overrideOriginal, flagReason, schemaVersion) intentionally not shown.

**Check turn-in payment flow re-split (June 25, 2026, refines the earlier proposal-total move).** Sophia wanted, in the payment flow: **Payment type → Proposal total from quote → Amount collected (last) → General notes** — amount collected becomes the very last data field, with proposal total right after the payment-type toggle (motivated by the financed-deposit case: pick Deposit, enter the full proposal total, then the deposit actually collected). Split the old single "Payment collected" section into three: **"Payment type — confirm against ePayPolicy receipt"** (just the full/deposit/direct toggle), then the **"Proposal total — verify against the quote"** section (moved up from after payment; dropped the "(do this last)" label + hint), then **"Amount collected — from ePayPolicy receipt"** (the `m-amtpaid` field + Net due + the deposit finance-row `m-finance-row` + direct-bill note). Net section order now: Premium → Commission → Payment type → Proposal total → Amount collected → General notes. All by-ID, no logic changes. Verified financed deposit: balance financed = proposal − collected ($5,500−$1,500=$4,000), broker-fee verify ✓, deposit hint neutral (no false red), `mCalc` clean. (Supersedes the prior "proposal total moved to the very end / do this last" placement.)

**Account-assignment validation bug FIXED + clickable "jump to field" errors + lazy draft saving (June 25, 2026, all logins).**

- **Bug: "Account assignment is required" wouldn't clear after picking House.** `setAgent()` set `agentMode` and updated the button visuals but — unlike `setPayMode`/`setCommMode` — never called `mCalc()`, so the validation banner didn't re-run until another field changed. Fix: added `mCalc();` to `setAgent()`. Now picking House/producer immediately clears the error and enables submit.
- **Clickable error → jumps to the field (Sophia's request).** The validation banner's error list items are now clickable: each `errs.push` became `E(msg, targetId)` (objects), and the list renders `<li class="vb-jump" onclick="jumpToField('<id>')">msg<span class="vb-jump-go">Fix →</span></li>`. `jumpToField(id)` scrolls the field under the sticky nav (manual `window.scrollTo`, NOT scrollIntoView per app rule — offset 100px), focuses inputs/selects/textareas, and **flashes it red** (`.jump-flash` keyframe: red ring + flag-bg fade over 2.4s; flashes the enclosing `.field`, or the `agent-row` for account assignment). Targets: insured→m-insured, polnum→m-polnum, poltype→m-poltype-input, txntype→m-txntype, invoice→m-invoice-num, eff/exp→m-effdate/m-expdate, insco→m-insco-input, mga→m-mga-input, account→agent-row, broker→m-brokerfee, commrate→m-commrate, amtPaid→m-amtpaid, proposal/mismatch→m-proposalcheck, net-due-negative→m-amtpaid.
- **Lazy draft saving — don't save an untouched form (Sophia's request).** Previously `startNewActiveDraft` eagerly pushed AND persisted a blank draft on every form-open, so opening-then-closing created saved empties. Now: (1) `draftHasContent()` broadened — ANY user-entered field counts (insured/company/polnum/poltype/txntype/txnNotes/invoiceNum/eff/exp/insco/mga/mgaInput/base/brokerFee/proposalCheck/commRate/amtPaid/notes/financeRef, or a non-empty agentMode); defaults excluded (taxes/mgaFee="0", payMode, commMode, office). (2) `persistDrafts()` now serializes a **pruned copy** that omits content-less drafts — a blank draft is NEVER written to storage (in-memory `drafts` is untouched so the active blank form stays editable). (3) `startNewActiveDraft` no longer persists the blank draft or shows "Saved" (new `showSaveIndicator('idle')` → "Ready — nothing to save yet"). (4) `saveActiveDraftFromForm` (fires on field blur + the backup interval) early-returns with 'idle' when still empty; the instant any field is filled it persists ("save it the moment something's typed, even if they then close it"). Combined with the load-time `pruneEmptyDrafts`, empty drafts never reach storage from any path. Verified: blank/default snapshot→not saved; one field (mga/insured/agent) →saved; submitted/approved kept; setAgent clears account error; 13 clickable jump-errors render with correct targets.

**Policy Ledger totals → floating sticky bar (June 25, 2026).** Sophia: didn't want to scroll to the very bottom of a long ledger to see the totals. Moved the totals strip out of the table `<tfoot>` into a dedicated `#ledger-totals-bar` div placed right after `.ledger-wrap`, styled `position:sticky; bottom:0` (z-index 6, surface bg, accent top-border, upward shadow, rounded top corners) so it **floats pinned to the bottom of the viewport** while scrolling the ledger and settles naturally at the end. `renderLedger` now writes the `.led-totstrip` (Totals count + Collected/Commission/Broker fees/Revenue/Producer 25%/Sophia 75% chips) into the bar and leaves `#ledger-tfoot` empty (no duplicate at the bottom). Reflects search/sort filtering live ("N of M"). The 4 metric cards at the top are unchanged (they already mirror Revenue/Sophia/Producer/Collected). Print unaffected (ledger is in the print-hide list). Verified: bar sticky, bottom 0px, 6 chips, tfoot empty.

**Check turn-in field reorder — "Proposal total from quote" moved to the END (June 25, 2026, all logins).** Sophia (flow): she wants the order broker fee → commission → payment collected → **proposal total from quote (last)**. Previously the "Proposal total from quote" input + "Broker fee verification" sat in the **Premium detail** section near the top, so the cross-check flashed red ("⚠ Required" / mismatch) while she was still entering — especially for **financed** policies where she hadn't yet reached the deposit/finance controls (in the Payment section below) to "clear that piece out." **Fix (pure layout reorder):** moved the `#m-proposalcheck` input (+ `#m-proposalcheck-label`, `#m-broker-hint`) and the `#m-brokerxcheck` verification out of Premium into a NEW section **"Proposal total — verify against the quote (do this last)"** placed AFTER "Payment collected" and BEFORE "General notes". The computed **"Proposal total (incl. broker fee)"** (`#m-proposaltotal`) stays in Premium as the running total. Added a hint explaining to enter it once premium/broker/commission/payment are all in. No logic touched — `mCalc`/`mValidate`/`formSnapshot`/`onTxnTypeChange` (invoice-mode relabel) all reference these by ID, so they work unchanged; cross-check verified (match→green, mismatch→Implied/Entered/Diff) in the new position. The PDF grouping is by field category (independent of DOM order) — unaffected. Section order now: Premium → Commission → Payment collected → Proposal verify → General notes.

**Empty-draft auto-cleanup (June 25, 2026, per Sophia).** Companion to the draft-cap fix. Added `pruneEmptyDrafts()` — removes abandoned EMPTY drafts (`status==='draft' && !draftHasContent` → no insured/polnum/base/amtPaid) from every user's bucket; never touches a draft with any data, anything submitted/approved/flagged/sent-back, or the currently-active draft. Called once in `hydrate()` right after drafts load, so empties are tidied on every page load and can't accumulate again. **One-time cleanup of live data:** 41 empty drafts cleared (Sophia 23→12, Kaylee 19→8, Mercedes 40→21 = 20 done + 1 real in-progress). **Gotcha observed:** localStorage is shared across the user's open tabs; a stale tab running OLD code kept re-persisting the empties over the in-memory prune, so the load-time prune alone "didn't stick" until the live tab reloaded with the new code. Resolved by also pruning localStorage directly + surfacing the page (forces the live tab to reload new code). Future loads are self-healing.

**Draft cap fix — submitted/approved check-ins no longer count (June 25, 2026).** Sophia hit "Maximum 20 drafts reached" while entering real check-ins. Root cause: `startNewActiveDraft` counted `bucket.filter(d => d.status !== 'draft' || draftHasContent(d))` toward `DRAFT_CAP_PER_USER` (20) — i.e. EVERY non-draft item (submitted, **approved**, flagged, sent-back) plus content drafts. So finished work blocked new entries (Mercedes had 20 done items = cap hit at 0 actual open drafts; Sophia 12 done, Kaylee 8 done; everyone had 0 genuinely-open drafts). This also contradicted the alert wording ("submit … before starting a new one"). **Fix:** cap now counts only **genuinely-open drafts** — `bucket.filter(d => d.status === 'draft' && draftHasContent(d))`. Submitted/approved check-ins are finished and don't count; the alert text updated to say so. Per-user cap still 20 OPEN drafts (plenty). Empty drafts (no insured/polnum/base/amtPaid) still excluded and are already hidden in My Items (line ~3536) + harmless to the cap; left in place (optional future cleanup, not blocking). Display total in My Items (`myitems-total`, line ~3539) still shows all items — unchanged (it's a count, not a gate).

**Highlight financed figures on the Check Turn-In PDF (June 26, 2026, all logins).** Sophia: on the printed/PDF check turn-in for FINANCED accounts, highlight the three numbers she cross-references against the IPFS finance agreement the agent emails — proposal total, amount collected (ePayPolicy), and balance financed. Added `.tp-hi` style (yellow `#fff3a8` bg with `print-color-adjust:exact` so it survives printing; bold value) and a `rHi()` row builder in `buildTurnInPrintDoc`. Those 3 rows render highlighted only when `f.payMode==='deposit'` (financed); on full/direct-bill they're plain (and Balance financed is omitted as before). Verified: financed entry highlights all 3 (yellow), non-financed highlights 0.

**Custom transaction type no longer persists + is deletable (June 26, 2026, all logins).** Sophia: after adding a custom transaction type (typing it + Enter/Add), it "stays there from now on" in the dropdown across check-ins; she wants it not to persist, and a way to delete one added by accident. Root cause: `addCustom` appended an `<option>` to `#m-txntype` permanently, and `clearFormDOM` reset the select's *value* but never removed appended options. **Fix:** options tagged `data-custom="1"`; `stripCustomOptions()` (called in `clearFormDOM`) makes them one-time; red ✕ button (`#txntype-remove-custom`) shown only while a custom option is selected (`refreshCustomRemoveBtn` via `onTxnTypeChange`) deletes via `removeSelectedCustom`; Enter in the input commits via `addCustom`; `loadSnapshotIntoForm` recreates a custom option for saved non-standard txntypes. Helpers guard `sel.options` (poltype is now a typeahead combobox, not a select). Verified end-to-end.

**Type-ahead comboboxes → prefix-first matching (June 25, 2026, all logins).** Sophia: typing "SCO" should surface everything that STARTS WITH "sco" (Scottsdale) immediately, not items that merely contain those letters — she types then Tabs, wants the least keystrokes to pull a known value. Changed the three type-ahead fields (Insurance company `inscoSearch`, MGA `mgaSearch`, Policy type `polSearch`) from `.filter(includes)` to a shared **`comboFilterSort` + `comboRank`** ranking: rank 0 = string starts-with query, rank 1 = a later word starts-with query, rank 2 = plain contains; sorted by rank, then the field's own comparator (alphabetical for insco/MGA, `polTypeCmp` for policy type so the Bond-Residential value order is preserved), then original index. Contains-matches are kept (nothing findable is lost — preserves voice/best-match behavior) but pushed BELOW prefix matches. The dropdown already auto-highlights the top option and Tab/Enter commit it (`comboKeydown` uses `opts[idx<0?0:idx]`), so prefix-first ordering means Tab now commits the starts-with hit. Verified: "sco"→Scottsdale #1 (Ascot/Hiscox/Wesco demoted), "gen"→General Liability, "c"→C-prefixed MGAs alphabetically. Transaction type is a native `<select>` (no text search — unaffected). Blur best-match (`inscoBlur`/`mgaBlur`) left as-is (unique-substring for voice). **NOTE:** Sophia's message also had a trailing "click/hover to open more detailed information" line — appears pasted from the ledger ask (comboboxes already show full names); not actioned, flag if she meant something specific.

**Policy Ledger redesigned → expandable rows (June 25, 2026).** Sophia: the 14-column ledger was "clogged up and overlapping"; wanted only the at-a-glance fields visible with the rest behind a click-to-open detail. Reworked from a 14-col fit-to-width table into a **6-column summary + click-to-expand detail panel**:
- **Summary columns (always visible):** chevron · Insured · Policy type (colored `polTypeChip`) · Policy # · MGA · Account (`acctTagHTML` chip) · MGA paid (Paid/Unpaid badge). Bigger type (.74rem) and roomy padding now that there are 6 cols not 14 — no more overlap.
- **Click any row** (`toggleLedgerRow(id,event)`) → expands an inline detail panel (`.led-detail`, second `<tr class="led-detail-row">` with colspan 7) showing the rest: Transaction (chip), Eff date, Submitted by (person chip), Collected, Commission (+%), Broker fee, Comm + Fee, Producer 25% (+%), Sophia 75%, and the **✎ Correct / ✕ Delete** action buttons (moved out of the insured cell into the panel; both `stopPropagation` so they don't toggle). Chevron rotates 90° when open.
- **Expansion state:** top-level `let _ledExpanded = new Set()` of row ids (view state, not persisted). Toggle re-renders (`renderLedger`), cheap at ~95 rows. Multiple rows can be open at once. State survives search/sort changes (set is by id).
- **Totals row → a flush strip** (`.led-totstrip`, single colspan-7 cell) with labeled chips Collected / Commission / Broker fees / Revenue / Producer 25% / Sophia 75% (since those money columns left the summary). Still reflects the filtered subset + "N of M" when searching. The 4 metric cards above are unchanged.
- Search box + sort bar from earlier today still work on top of this (filter → sort → render summary+detail pairs). Edit/Delete still call the same `openLedgerInForm`/`deleteLedgerEntry` — no money/business logic touched, display-only restructure.

**Policy Ledger insured search box (added June 25, 2026).** Sophia: as the ledger grows past 200 rows, scrolling to find an insured is slow — wanted to type letters and jump to it. Added a live filter (not a jump-to): a `🔍` search input (`#ledger-search`) above the Sort bar, `setLedgerSearch(val)` → `ledgerSearch` (top-level `let`, view-state only, not persisted) → `renderLedger` filters `_rows` by `insured.toLowerCase().includes(query)` BEFORE sorting. Substring, case-insensitive, matches anywhere in the name. Esc or the ✕ clears it. Empty result shows a `.ledger-no-results` row ("No policies match …"); the totals row + footer count show the filtered subset ("4 of 95" / "4 / 95") so it's clear a filter is active. **Note:** the four metric cards (Collected/Revenue/Prod/Sophia) + totals row reflect the FILTERED rows while searching (intentional — totals of what's shown); they restore to full on clear. Scoped to the insured column only (per the ask); could extend to policy #/MGA later if needed.

**Working agreement (IMPORTANT going forward).** Sophia is now doing ALL data entry and updates **in this version** (`wcib_dashboard_v14.html`), NOT the web copy, to avoid the localStorage-per-browser split that caused today's merge. Data lives in this browser's localStorage. **Back up (export) before/after heavy sessions.** If she ever touches the web copy, back up there and Restore here.

**Data merge → 93 policies (`WCIB-data-merged.json`).** Merged Sophia's uploaded backup (34 brand-new, **unsettled** policies, `mgaPaid:false`) into the 59-policy settled dataset that was in this version's localStorage. Rules (confirmed): keep all 59 settled as-is; append the 34 (deduped by id — no collisions); union the open June Sophia pay sheet's policyIds (no duplicate sheet); keep ONE budget set; union/dedupe MGA/poltype/insco/staff lists. Result verified by loading into the app: **93 ledger, 34 unpaid in MGA Payables, 59 settled, 29 approved (inert) queue entries, 2 budget months.** Backup format = `{app,kind:"wcib-backup",version:20,exportedAt,keys:{<STORAGE_KEYS>:"<stringified JSON>"}}`. The 29 queue entries are status `approved` (inert — `renderApprovals` only shows `pending`). `WCIB-data-merged.json` is in the project root.
- The 34's referenced MGAs/inscos/poltypes all already existed in the live lists (poltypes identical); producer Kaylee + all submitters already in staff. So merge was clean with no list additions needed.

**Budget: KEPT the version that was in this app (NOT the upload's).** The upload carried an OLDER budget (bare employee names, "Executive Assistant (TBD)", $0 June income, pre-migration scalar rentalIncome). This app's budget is the current one: full role labels (Mercedes - CSR/Backoffice, Daniela - Renewals Specialist, Joseph - Agent & Renewals Specialist, Earl - AI Generalist / Operations, Hector — Roshak/Uplands Landscape, Todd - Landscaping, Alicia - Filing Front Desk, Ellycia - CSR, **Chloe - Executive Assistant**), Kaiser/Paychex/IRA-Contribution payable renames, Medford Builders Exchange, IT Company $1,134, Now Certs $439, Vistage→Alaska, IdealTraits $999 in Annual, June income $60k pay-sheet-bound, rentalIncome as a map. Schema 20. **Confirmed correct with Sophia.**
- **Why the budget "looked old" to Sophia (resolved, no data problem):** v14 renders an (empty) **Property dropdown on every Hard Bill** (deliberate schema-19 widening, reversing the old mortgages-only restriction), and the tax line shows Charged-to/Due controls because it's named **"Income Taxes"** not exactly **"Taxes"** (the auto-tax-reserve line is keyed to name === "taxes" or `autoTax` flag; "Income Taxes" is treated as an ordinary $18,000 manual hard bill, not the auto-30%-of-gross reserve). Her data edits (no property/charged-to on those lines) ARE intact — it's the controls that render, not stored values. **Left as-is** (she said "maybe it is correct, proceed"). If she later wants the tax line back to auto-30%, rename it to "Taxes" or set `autoTax:true`; if she wants property hidden on non-mortgage hard bills, that's a code change to `showProp` in `renderBudgetRow`.

**Budget page layout (CSS/JS).** `#page-budget{max-width:1340px}` (was the shared `.page` 980px) so more columns fit before scrolling. The sticky `.bdg-summary` income bar now **condenses on scroll**: `updateBudgetSummaryCondense()` toggles `.bdg-summary.condensed` when its `getBoundingClientRect().top <= 45` (stuck under the 43px nav); condensed hides `.bdg-sum-note`, shrinks values/labels/padding (~80px reclaimed). Bound once via `bindBudgetStickyScroll()` (window scroll/resize), called at end of `renderBudget()`. **Gotcha:** do NOT put `padding` in the `.bdg-summary` `transition` — a transitioned padding got stuck at its start value via getComputedStyle; transition is `box-shadow` only, padding snaps.

**Effective/expiration date: 4-digit auto-format.** `toSlashDate()` now handles a 4-digit run as **M D YY** (e.g. `6926` → `06/09/2026`), in addition to the existing 5–8 digit handling. Invalid (month/day = 0, e.g. "0926"/"6086") left as typed. One shared check-in form + `normalizeDate` serve ALL logins (admin/employee/producer) and the ledger-edit + draft-restore paths, so the one fix covers everything; fires on the field's `onchange`.

**Check turn-in submit bug — FIXED (was: "can't submit, no errors shown").** `mValidate` had a third silent branch: when there were no field errors but `base<=0`, it hid the banner entirely AND disabled submit — a dead end with no explanation. But the code already supports **broker-fee-only (base=0)** policies via a confirm in `submitTurnIn()`. Fix: collapsed the `else if(base>0&&amtPaid>0)` + silent `else` into a single `else` that shows green + **enables submit whenever there are zero errors** (the base-0 confirm still guards genuine broker-fee-only cases). No more silent state. (Root cause of Sophia's report was entering an endorsement/invoice with no base premium.)

**Invoice mode for Endorsement & Audit.** Sophia: these are WCIB **invoices**, not quotes — but they STILL have base premium / taxes / MGA fee (money model unchanged). When txntype is Endorsement or Audit (`isInvoiceTxn()`):
- The **"Proposal total from quote"** field LABEL (`#m-proposalcheck-label`) becomes **"WCIB Invoiced Amount"** (title only — same field, same input, same broker-fee cross-check math). Reverts for New/Renewal/Rewrite/Cross-sale.
- A required **Invoice #** field (`#m-invoice-num`, in `#txn-invoice-row` inside `txn-notes-wrap`) appears; the existing detail box = "what it's for". Validation pushes "Invoice # is required for an endorsement/audit".
- Persisted as `invoiceNum` in formSnapshot / entry / queue; restored on edit/draft load (via `onTxnTypeChange()` called in `loadSnapshotIntoForm`); printed on the turn-in sheet; cleared + label reverted in `resetFormState`.
- Driven by `onTxnTypeChange()`. **Open item:** Invoice # is currently REQUIRED for endorsement/audit (Sophia can ask to make it optional); older endorsement/audit ledger records have no invoice # so they'll prompt on re-save.

**Scroll-to-top after finishing a check-in.** `submitTurnIn()` already had `window.scrollTo({top:0,behavior:'smooth'})` in all branches; added the same to the **Notify Sophia** path (`submitHelpRequest()`) so both return to the top for the next entry.

---

## Pay-sheet print/PDF rework + IdealTraits (June 24, 2026, `wcib_dashboard_v14.html`, BUDGET_SCHEMA → 20)
v13 copied → v14 first (v13 preserved untouched). Standalone-HTML / top-level-`let` / BUDGET_SCHEMA+migrateBudgets / test-harness architecture + all design/color decisions kept. Sophia's questions form timed out — applied these defaults (all confirmable later): live agency-summary cover, one-agent-per-page, repurposed the main print button, IdealTraits → Annual (reference-only).

**Print = the WHOLE agency in one document (`printAgencyReport()`).** The top “Print” button (relabeled **“🖨 Print full agency report”**, was “Full report — all agents” → `printAllPaySheets`) now calls `printAgencyReport()`:
- **Page 1 = a live company-summary cover** (`agencyCoverHTML()`): the **5 agency totals** (Total Broker Fees / Total Commissions / Total to Pull from Trust / Checks-ACH Commissions / Grand Total Income, same `c-broker/c-comm/c-trust/c-back/c-grand` color cards as the sheet), a chargeback-netting note, an **Activity this period** card row (New / Renewal / Retention / Total policies), a **By account type** row (House / Producers’ book / 1st-yr house / Paid to producers), and **Activity by transaction type** (reuses `kpiTxnTypeHTML`). Computed **live from the OPEN sheets** so it’s always populated even before a month closes; the same math reflects closed figures once closed. (Chosen over wiring the closed-only company KPI view, which is empty until June closes — the KPI *tab* staying empty pre-close is expected/unchanged.)
- **Then every agent on its own page** — Sophia’s House sheet (all Account→Transaction groups + Chargebacks & Adjustments + Checks/ACH + the 5 totals), then each producer (with their mirrored read-only Chargebacks). Injects the cover into `#ps-all-sheets`, force-shows all `.ps-person-block`s, page-breaks before each, expands closed panels, then `window.print()`; cleanup re-renders (drops the cover). Nothing persisted.
- **Per-agent “Print sheet” button unchanged** (`printPaySheetPerson` → `_paySheetPrint`): hands a producer ONLY their own page with their chargebacks, no company cover/totals (employees never see agency financials).

**Print bugs fixed (root cause was one CSS line).** The old rule put `break-inside:avoid` on the whole `.ps-sheet`, forcing Sophia’s ~60-row sheet to try to fit a single page — the browser clipped everything past it (“rows cut off after Lutris Electric,” “totals print blank,” “producers missing” were all the same clipping). Fixes in the `body.print-paysheet` @media print block:
- `.ps-person-block` / `.ps-sheet` / `.ps-closed-panel` → `break-inside:auto` (flow across pages); `break-inside:avoid` moved onto individual **rows/cards** (`.ps-row-sophia`, `.ps-row-prod`, `.ps-adj-row`, `.ps-padj-row`, `.ps-dd-row`, `.ps-tot`, `.ps-bd-card`, `.kpi-card`, `.ps-cb-wrap`); `break-after:avoid` on group/sub-group/column headers so a header never strands at a page bottom.
- **Color system carries into the PDF:** `body.print-paysheet, body.print-paysheet *{ -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important }` — chips, the blue/green Broker/Commission columns, the colored total cards, and the red chargebacks all print.
- **Neutralized the `.ps-col-broker`/`.ps-col-comm` negative margins in print** (`margin:0; padding 4px`) — their full-height bands overlapped/clipped across a page break; the blue/green tint is kept.
- Added `#page-kpi` to the print-hide list (belt-and-suspenders).

**Regression — re-verified on Sophia’s live saved data (schema now 20):** Pay-sheet totals intact — **Trust = Broker + Commission** (51,160.34 = 32,781.66 + 18,378.68) and **Grand = Trust + Checks/ACH** (65,722.71 = 51,160.34 + 14,562.37); budget gross income still binds to Sophia’s Grand Total Income (65,722.71). Chargeback mirror works (she has since changed the ABC Construction adjustment to **broker −$100, house::Kaylee** → Kaylee mirror −$25 = her 25%). Budget **Total expenses / Remaining / Operating View** compute; **Annual stays reference-only** (its own $4,227 total shown, excluded from headline expenses). NOTE: her live data now has 62 policyIds on Sophia’s open sheet vs 59 resolvable ledger rows (3 stale ids from her own corrections-to-adjustments edits) — `computeSheetTotals` safely skips unresolved ids; pre-existing, not introduced here.

## Pay-sheet layout & color refinements (June 24, 2026, v14)
Sophia's feedback on the colored pay-sheet system. All in `renderSheetBody` + the chip/column CSS.

- **Policy type is now the LAST column on every sheet.** Sophia: `Insured · Broker fee · Commission · Account type · Transaction · Policy type`. Producer: `Insured · Payout · Account · Transaction · Policy type` (payout moved to 2nd, policy type to last). Grid templates + the matching `.ps-totals-row.sophia/.prod` grids updated to suit.
- **Transaction-type sort within each account section.** Rows are grouped by account type (House / Producers’ book / 1st-yr house, with the colored `.ps-group-hdr` headers), and **within each account section rows cluster by transaction type** (TXN_ORDER: New → Renewal → Endorsement → Audit → Cross-sale → Rewrite), **alphabetical by insured inside each cluster**. So the House section lists all New together, then all Renewals, etc. — no more New/Renewal/Cross-sale interleaving. (NOTE: this reverses the brief mid-session de-cluster; Sophia/Earl confirmed they want txn clustering, just *within* the account-type sections, not as separate header rows.) `txnGroups()` is back in use.
## Owner (Sophia) employee-login account assignment — full options (June 24, 2026, v14)
On the "Sophia" employee login, the account-assignment row showed only House + each producer's book (no 1st-year) because she's a non-producer employee. Fix: `renderAgentButtons` now treats the OWNER (`currentRole==='admin' || currentUser==='Sophia'`) like the admin — House + for every producer BOTH "{name}'s account" (book) AND "{name} 1st Year" (house). A data-entry employee (Mercedes) still gets books only; producers still self-only. Covers future producers automatically. (The bond-residential dropdown order — $25k→$10k via `polTypeCmp` — was already implemented/verified earlier and confirmed still correct across logins; a stale page was the cause of the re-report.) Verified: Sophia→House+book+1st-year per producer; Mercedes→books only; Kaylee→self only.

## Voice (Wispr) dates + carrier/MGA + bond ordering (June 24, 2026, v14)
- **Selected account-assignment stands out.**The chosen `.agent-btn` is now a bold FILLED card (House = forest `--accent`, producer/book/1st-year = `--navy`) with white text, `font-weight:600`, an accent-light focus ring + drop shadow, and a slight lift — vs white for unselected. Was a faint pastel tint before. Verified selected=navy/forest+white+shadow, unselected=white.
- **Date fields accept voice/typed dates.** `m-effdate`/`m-expdate` are `type="text"`; `onchange` runs `normalizeDate()` → **MM/DD/YYYY**, accepting pure-digit runs (via `toSlashDate`, 6-digit disambiguated by month validity: 060526→06/05/2026, 652026→06/05/2026), separator forms (6/5/26, 06-05-2026 → split into M/D/Y, 2-digit year→20YY, 2-part = month/year w/ day 1), spoken ("June 5 2026"), and ISO. `fmtDate` + `autoExpiry` parse both MM/DD/YYYY and legacy ISO; autoExpiry outputs MM/DD/YYYY. Applies on every check-in/login.
- **Net due to MGA line.** Now in the **Payment** section directly under "Amount collected" (`#m-netdue`) = amount collected − commission − broker fee, live via `mCalc` (populates once the collected amount is entered); label is just "Net due to MGA" (no formula shown). Also on the clean PDF. Every login.
- **Select-on-focus for the type-to-search dropdowns** (policy type, insurance company, MGA — `#page-turnin` focusin handler, alongside number inputs): clicking the field highlights its contents so a wrong Tab-pick can be retyped without erasing. Transaction type is a native `<select>` (no text to clear). Every login.
- **Carrier/MGA best-match on blur.** `inscoBlur`/`mgaBlur` now auto-commit a dictated value: exact (case-insensitive, trailing punctuation ignored) or a unique substring match selects the list entry — so voice text like "kinsale insurance company" commits without clicking. (selectInsco still fires the carrier→MGA rule.)
- **Bond - Residential dropdown order:** `polTypeCmp` keeps the list alphabetical except the "Bond - Residential - $Xk" group sorts by value **highest→lowest** ($25k, $20k, $15k, $10k). Applied to the `polSearch` dropdown. Verified all of the above; no console errors.

## Broker-fee-only check-ins: $0 base + N/A commission (June 24, 2026, v14) there's no premium — just a broker fee. (1) **Base premium $0 allowed:** removed the hard "Base premium is required" validation; `submitTurnIn` instead shows a `confirm()` when base isn't > 0 ("No base premium entered — confirm this is a broker-fee-only policy"); cancel re-enables submit and aborts. (2) **Commission N/A:** added a third commission-type toggle **"N/A — broker fee only"** (`ct-na`, `commMode='na'`) alongside Percentage / TBD — hides the rate field, shows "N/A," needs no rate (no validation error). `commission` stores 0; ledger + PDF show "N/A" (not $0/TBD); `commPctLabel` skips na. Applies on every check-in/login. Verified: base-confirm in submit, base error gone, N/A toggle hides rate + shows N/A. **Also: an explicit 0% commission (pct mode) pushes through** — the rate validation now blocks only a BLANK rate, so 0 is accepted on every submit path incl. admin corrections (blank still prompts).

## Insurance-company → MGA auto-rules (June 24, 2026, v14)
Sophia: selecting OR typing/dictating certain carriers should always set the MGA. `applyInscoMgaRule()` matches the chosen insurance company (substring, case-insensitive) and auto-sets the MGA: Western Surety → CNA, Progressive → Progressive, GEICO → GEICO, Travelers → Travelers (adds to `mgaList` if missing). Fires from ALL carrier-commit paths: `selectInsco` (dropdown pick / Tab / blur best-match) AND `inscoSearch` exact-match branch (typing/dictating the full name — this was the gap). Applies on every login. Verified.: **Western Surety → CNA, Progressive → Progressive, GEICO → GEICO, Travelers → Travelers**. Adds the MGA to `mgaList` if missing (so it's a valid payable) and calls `selectMGA`. Other carriers leave the MGA untouched. Re-applies if the carrier is changed. Verified all four + a non-rule carrier (no change); no console errors.

## Renamed Oregon Residential bond types (June 24, 2026, v14)
Sophia: rename the four "Bond - Oregon R - $Xk" (Oregon Residential) types to "Bond - Residential - $Xk", keeping each value amount. Updated the default `polTypeList` and added `renameOldPolTypes()` (runs every load in hydrate, after the poltypes load) that maps the four old names → new in the controlled-vocab list AND every place stored: ledger, queue, drafts (`formData.poltype`), and pay-sheet snapshots — then re-sorts the list. No-ops once migrated. Verified: no "Oregon R" left, four "Bond - Residential - $Xk" present, ledger clean.

## Check-in PDF download = clean one-page summary (June 24, 2026, v14)
Sophia: the "Download PDF" should be just the entered data — no form chrome / draft / submission UI — with the submitter's login, the date, and an "Internal — New Check Turn-In" header, ideally one page. `downloadForm()` now builds a dedicated `#turnin-print-doc` from `formSnapshot()` + `_assignFor()` (header + submitter `currentUser` + `fmtDate(todayISO())`, then label/value rows grouped Policy / Premium / Commission / Payment / Notes; empty fields omitted; account assignment resolved to House / book / 1st-year). Adds `body.print-turnin` which (in `@media print`) hides everything in `#page-turnin` except the doc. Works for both employee and admin forms. Verified: clean doc renders with submitter + date, no console errors.

## Check-in field fixes: auto-expiry year guard + select-on-focus (June 24, 2026, v14)
- **Fixed the "6/11/0003" expiration bug.** `autoExpiry` could fire mid-typing on a partial/low-year effective date and set a junk expiration that then stuck (it wouldn't refill once non-blank). Now: skips when the effective-date year `< 2000` (implausible/partial); fills when expiration is blank OR was itself auto-filled (`exp.dataset.auto==='1'`) so correcting the effective date updates it; never overwrites a manually-typed expiration (the field clears `dataset.auto` on user input). Verified: 2026→2027 fills, year 0002 stays blank, corrected eff refills, manual value kept.
- **Numeric fields select-on-focus** (scoped to `#page-turnin`): clicking a number input highlights its contents, so the default `0` (taxes/MGA fee) or a pre-filled value (when correcting via Edit) is typed over without first deleting it. Global `focusin` handler — no per-input changes.

## Policy Ledger: sort, in-place edit, delete (June 24, 2026, v14)
- **Fit-to-width (no horizontal scroll) + numbers never wrap.** `.ledger-table` is `table-layout:fixed; width:100%` at `.62rem`; **every cell defaults to `white-space:nowrap`** so numeric columns (policy #, eff date, collected, commission, broker fee, comm+fee, prod 25%, S 75%) always stay on one line. Only the genuinely-text columns (insured, MGA, txn, submitted-by, account, MGA-paid) opt back into wrapping via `nth-child` + `overflow-wrap:anywhere`. Proportional widths keep all 14 columns on the page (no left/right scroll). The **totals row** values are now rounded **bubbles** (`.led-tot`, nowrap) at `.62rem` so no total ever breaks across two rows.
- **Sort controls** (`#ledger-sortbar` + `setLedgerSort`): Date added (default, entry order) / Insured A–Z / MGA / Transaction / Submitted by / **Account** (House first, then producer books, then 1st-yr; insured tiebreak). `renderLedger` sorts a copy (`_rows`) — never mutates `ledger`.
- **In-place Edit** (✎ on each row → `openLedgerInForm`): loads the approved policy into Sophia's admin form (all fields + full assignment, proposal cross-check prefilled from stored `proposalTotal`). On admin submit, `_editingLedgerId` updates the SAME ledger entry in place via `Object.assign(ex, entry, {keep id/approvedAt/mgaPaid/mgaPayRef/paidAt/onPaySheets/submittedBy/submittedById})` and re-renders ledger+MGA+pay sheets (open sheets reflect the fix live; closed snapshots keep history). Lets Sophia correct something that slipped past approval (e.g. Papaya marked 1st-yr Kaylee but should be House).
- **Delete** (✕ on each row → `deleteLedgerEntry`, admin-only + confirm): for a flat-cancel / entered-in-error — removes the policy from the ledger, MGA payables, and any open pay sheet's `policyIds`/`policySnapshot`, then persists + re-renders. Closed-sheet snapshots retain history. Stops a bad entry from continuing through the process.
- All three reuse the shared assignment helpers; `_editingLedgerId` is cleared in `resetFormState` so it can't leak into a later normal entry. Verified: sort reorders, edit loads the form, delete/edit buttons present, no console errors.

## Approvals & Help-Requests workflow upgrades (June 24, 2026, v14)
- **Queue grouped: non-house items prioritized & separated.** `renderApprovals` partitions pending entries into flagged (`kaylee!=='none'` — producer book or 1st-year) and house, renders flagged FIRST under a "⚑ Needs verification — non-house assignments (N)" header, then "House account — standard (N)". Headers only appear when both groups exist (all-house = no headers). Lets Sophia verify the non-house ones up top without hunting. `.appr-group-hdr` styling; headers aren't `.queue-item`/`.qi-sel` so expand-all/select-all/bulk-approve ignore them.
- **Approval cards show the transaction type** — `txnChip(d.txntype)` added to the `qi-sub` line so New vs Endorsement (etc.) is visible at a glance without opening.
- **Verify flag on ANY non-house assignment.**The approval-card `reviewFlag` now fires for every assignment other than House/agency: `kaylee==='house'` → "⚑ 1st-year house — verify"; `kaylee==='book'` → "⚑ {producer} account — verify" (regardless of who submitted — so Mercedes assigning e.g. Papaya Contracting to Kaylee's book is caught). `kaylee==='none'` (house) shows nothing. Lets Sophia catch & verify producer assignments without opening each.
- **Edit & fix on the approval screen** (`openQueueInForm`): loads a pending submission into Sophia's admin check-in form (all fields editable + full assignment options), prefilling the proposal cross-check from the stored `proposalTotal` so validation passes. On the admin "Add directly to ledger", the original queue entry (and any linked draft) is resolved/removed (`_fixingQueueId`). Fixes a typo (e.g. policy #) with no send-back round-trip.
- **Help Requests: replaced the "teach later" snooze** with **Open & fix (admin)** (`openHelpInForm` — loads the flagged item into the admin form, maps the submitter's assignment into `adminAssign`, resolves the flagged draft to approved on submit via `_fixingHelpDraftId`) and **Send back** (`sendBackHelp` — reuses the send-back modal via `_sendBackIsDraft`, returns the item to the submitter with a note). Kept **Push through as-is**. Per Sophia: she always opens with full admin permissions to review+push; teaching happens in person — no snooze.
- Shared `_assignFor`/`agentToAssign`/`assignValueOf` used so 1st-year and book assignments round-trip through both the queue-edit and help-fix flows. Verified with throwaway in-memory entries (never persisted): flag text, txn chip, Edit/Open&fix load the form with correct values + adminAssign; no console errors.

## Cleanups: remove test insured, ledger producer %, auto-expiry, drop Carrier fee (June 24, 2026, v14)
- **Removed the "Alden Powell Construction" test insured.** Emptied the `ledger` seed (`let ledger = []`) and added `stripTestInsureds()` (runs every load in `hydrate`): removes any `/alden powell/i` record (or `seed-001`) from the ledger AND scrubs its id/insured from every pay-sheet `policyIds`/`policySnapshot`/`adjustments`, the approval queue, and drafts (`formData.insured`). Verified gone (ledger 59, no Alden).
- **Ledger: producer's own % next to their share.** New `prodPctLabel(p)` appends the producer's commission rate (from `getProducerRateOn`, new vs renewal by txntype; default 25%) to the producer-share column for producer-assigned rows — e.g. "$208.36 (25%)" — so Sophia can confirm at a glance the producer is credited the right rate. (Mirrors the existing `commPctLabel` on the carrier-commission column.)
- **Auto-suggest expiration = effective + 1 year.**`autoExpiry()` fills the expiration only when it's blank (override-able), now **scoped to known annual policy types** (`ANNUAL_POLTYPES` = general liability, inland marine, worker['s comp], pollution, errors[& omissions]) — other terms vary, so they're left to the user. Triggers on effective-date change AND on policy-type pick (whichever is entered second). This is the safe, deterministic slice of Sophia's "AI patterns" idea; the broader pattern-learning (MGA↔carrier auto-suggest) is deferred — revisit as lightweight analytics over the agency's own ledger once more data accumulates (no external AI needed). Verified: GL/inland marine/WC/pollution/E&O fill +1yr; Bond stays blank.
- **Removed the "Carrier fee" line item** from Premium detail (Sophia: there's no carrier fee). Deleted the `m-carrierfee` input and cleaned every reference: `mCalc` (`cTotal=base+taxes+mgaFee`), `mValidate` cross-check, `formSnapshot`/`restoreSnapshot`, both entry builds (`proposalTotal=base+taxes+mgaFee+brokerFee`), and `clearFormDOM`. No other tab displays carrier fee (ledger/MGA read netDue/commission/broker), so nothing else needed changing. Verified proposal total computes correctly without it.

## Per-login Account Assignment + producer self-assign 1st-year (June 24, 2026, v14)
Sophia/Earl: the check-turn-in Account Assignment must be scoped to who's logged in. Driven off the staff **role** (set in Settings → Manage Staff), per Sophia ("defined in the setting section when adding a new producer"):
- **Producer login** (`role==='producer'` — Kaylee, Joseph, Sam Newbee, …): sees only **House account**, **{Name}'s account** (their book), and **{Name} 1st Year** — never another producer's account. The "1st Year" button self-assigns `{producer:self, kaylee:'house'}` (1st-year house: they earn 1st-year commission/fees but it's a house account).
- **Accounts manager / data-entry employee** (`role==='employee'` — Mercedes, and Daniela until/unless promoted): sees **House + every producer's book**, **no 1st-year** option (Sophia sets 1st-year at approval). Mercedes processes the bulk, so she needs access to everyone.
- Daniela stays an `employee` for now (so she gets the manager view); Sophia will set producer role + rates herself in Manage Staff when ready (she declined auto-default rates).
- **Encoding:** new shared `agentToAssign(am)` maps the form's agent selection → `{producer,kaylee}`: `'sophia'`→house, `'house:<Name>'`→that producer's 1st-year house, bare name→book. Used by `_assignFor()` and the draft→entry build so 1st-year flows through submit correctly. `renderAgentButtons()` is now role-aware; admin (Sophia) form unchanged (full control).
- **Review flag for Sophia** (her request): approval-queue cards now show an amber **⚑ 1st-year — verify** badge when `kaylee==='house'`, or **⚑ Producer self-assigned — verify** when a producer submitted their own book (`submittedBy===producer && kaylee==='book'`), so she can check accuracy. (Everything already routes through her approval queue; this just highlights what to scrutinize.)
- Verified: Kaylee/Joseph → House + own + own 1st Year; Mercedes/Daniela → House + all producers, no 1st-year; `agentToAssign('house:Kaylee')`→`{Kaylee,house}`.

## Commission section: lead with the % (June 24, 2026, v14)
Sophia: on the check turn-in Commission section, lead with the percentage. Reordered the `g4` to **Commission % → Commission amount → Commission type (Percentage | TBD)**; the % and amount fields widened to `s2`. Percentage is already the default mode, so the % field is front-and-center and ready to type, and the amount auto-populates via `mCalc`. `setCommMode` now keeps `comm-amt-wrap` visible in TBD mode too, so picking **TBD** (leave the % blank) shows "TBD — carrier pays later" in the amount box. Validation already requires a % unless TBD, so the flow reads: type the %, or tap TBD and enter nothing.

## Faster bulk approvals (June 24, 2026, v14)
Sophia: when ~20 submissions pile up, reviewing/approving them one-expand-at-a-time is too many clicks. Added to the Approvals page (`renderApprovals` + a new toolbar):
- **Toolbar** (`#approvals-toolbar`, shown only when there are pending items): **Select all** checkbox, **Approve selected (N)** (green when armed), and **Expand all / Collapse all**.
- **Per-row:** a selection checkbox (`.qi-sel`, `data-qid`) and a one-click inline **✓ Approve** on the collapsed header — approve without expanding, using the row's current commission assignment (which already defaults from the employee's account pick). `event.stopPropagation()` keeps the checkbox/approve click from toggling the row's expand.
- **Bulk approve** (`bulkApproveSelected`): snapshots the checked ids, confirms count, then calls the existing `approveQE(id)` per item (reuses all the ledger-push / draft-sync / persistence logic — no duplicated money logic). Confirm copy tells her items needing an override should be reviewed individually (bulk path applies no overrides).
- **Expand/Collapse all** (`toggleAllApprovals` / `setAllQIExpanded`): scan every submission's detail at once; state re-applies after the list re-renders.
- Verified with throwaway in-memory entries (never persisted): toolbar + checkboxes + inline ✓ Approve render, expand-all opens all panels, select-all arms "Approve selected (N)". The deeper review (commission reassignment, overrides, send-back) still lives in the per-row expand — unchanged.

## Keyboard-first check turn-ins + $0 broker fee fix (June 24, 2026, v14)
- **Tab/keyboard nav on the three type-ahead comboboxes** (Policy type, Insurance company, MGA). They were mouse-only (`onmousedown` to select) and tabbing away cleared typed text. Added `comboKeydown(event, kind)` on each input: **↑/↓ move the highlight, Enter picks it, TAB commits the highlighted/top match and advances to the next field, Esc closes.** As you type, the first match is auto-highlighted (only when there's a query), so Tab accepts the obvious choice. Each option div now carries `dataset.name` (the clean value) so selection doesn't depend on parsing `<mark>` markup. The Tab commit is guarded to only fire when the input has typed text (empty field just tabs through). Lets Sophia/Kaylee fly through a check turn-in without the mouse. Verified: "AM" → Tab → "AM Wins" committed; ↓↓+Enter on carrier → "Zurich Group".
- **$0 broker fee no longer blocks submit.** `mValidate` used `if(!brokerFee)` (numeric) so a legitimate **0** broker fee raised "Broker fee is required." Changed to check the raw input is non-blank: `document.getElementById('m-brokerfee').value.trim()===''` → 0 is accepted, a truly empty field still prompts ("enter 0 if there is none"). The proposal cross-check still reconciles (a real no-broker-fee policy has proposal total = carrier total, diff ≈ 0). Verified: brokerFee=0 drops the error; blank still flags.

## Pay Sheets at-a-glance KPI widget (June 24, 2026, v14)
Sophia/Earl: a KPI widget at the top of each agent's pay sheet (below the agent name, above the sheet), at-a-glance with click-to-expand detail. Decisions from the question round:
- **Context-aware:** built per `.ps-person-block`, so it follows the agent sub-tab. **Sophia → House/agency KPIs; producer → that producer's KPIs.** `paySheetKPIHTML(person, liveSheet)` inserted into each block's markup.
- **Live current period:** computed from the agent's **open** sheet (`personSheets.find(open) || latest`) so it's populated now even though June isn't closed — `computeSheetTotals` + `sheetPolicyRecords`.
- **Click = inline expand** (not jump to the KPI tab — that tab reads closed sheets only and would be empty for the open month). `togglePaySheetKPI` flips `.expanded` on ALL widgets at once (only one is visible via tabs) and persists to `localStorage['wcib_ps_kpi_exp']`.
- **House at-a-glance:** the 5 money totals (band-colored chips, Grand = forest) + New / Renewals / Paid-to-producers; **expand →** account mix (House / Producer book / 1st-yr house) + Workers' comp + Surety bonds counts.
- **Producer at-a-glance:** Commission payout (headline) + New / Renewals / Total policies; **expand →** Their book vs 1st-yr house + policies-by-type counts.
- **Dropped "retention rate"** from the widget: with no lapse/non-renewal data, renewals÷all-policies isn't a real retention rate (Sophia flagged this). NOTE: the same misleading "retention rate" still appears on the existing **KPI tab (`kpiCompanyHTML`) and the print cover (`agencyCoverHTML`)** — offered to remove/relabel there too; awaiting Sophia's call.
- **Print:** `.ps-kpi-widget` added to the print-hide list — the widget is screen-only (the printed agency report already has the company-summary cover). Verified: Sophia's 5 totals match the sheet's bottom totals; Kaylee's payout/splits correct; expand persists; no console errors.

## Agent sub-tabs on the Pay Sheets page (June 24, 2026, v14)
Earl's suggestion (via Sophia): instead of every agent's sheet stacked on one long page, put a **sub-tab bar inside the Pay Sheets page** — below "Print full agency report", above the sheets — with one tab per agent (Sophia + each producer that has a sheet). Click a tab to view just that agent. **This is a sub-tab within Pay Sheets, NOT a new top-level nav tab** (it does not sit alongside MGA Payables / Policy Ledger).
- **Markup:** `<div id="ps-agent-tabs">` added between `#ps-print-bar` and `#ps-empty-msg`. Built in `renderPaySheets` from the rendered `.ps-person-block`s; only shown when there's >1 agent (just Sophia → no tabs).
- **State:** top-level `let paySheetTab` (default `'Sophia|sophia'`), persisted to `localStorage['wcib_ps_tab']`. `setPaySheetTab(key)` + `applyPaySheetTab()` toggle `.ps-person-block.ps-tab-off{display:none}` on non-active blocks and `.active` on the chosen tab — no full re-render, so input focus is preserved. Falls back to the first agent if the stored key no longer exists.
- **Print stays intact (both paths):** `@media print` neutralizes the on-screen tab hiding — `body.print-paysheet .ps-person-block.ps-tab-off{display:block!important}` — so the print logic (`.ps-print-hide`) is the sole authority during print. Full agency report → no `.ps-print-hide` set → every agent prints (regardless of which tab is active); per-agent "Print sheet" → `.ps-print-hide` on non-targets → only that agent prints. `#ps-agent-tabs` is added to the print-hide list so the tab bar itself never prints. Verified: default shows only Sophia, switching to Kaylee swaps the visible block, and all three print rules are present; no console errors.

## Checks/ACH section moved above the totals (June 24, 2026, v14)
Sophia: on Sophia's pay sheet the **Checks/ACH Commissions** section now sits **below Chargebacks & Adjustments and above the 5 total cards** (was at the very bottom). `renderSheetBody` now injects `${ddSection}` between `${adjSection}` and `.ps-totals-final` inside `totalsHTML`, and the return dropped its trailing `+ ddSection`. Display-only change — totals math (Trust/Grand, the `back`/`grandInc` values) unaffected. Verified DOM order: Per-policy totals → Chargebacks → Checks/ACH → 5 Totals.

## Chargeback + Checks/ACH text → black (June 24, 2026, v14)
Two inline-comment refinements after the light-bubble totals change:
- **Chargebacks & Adjustments section:** font is now **default black**, with **red reserved for** the "⚠ Chargebacks & Adjustments" title, the dollar-amount inputs (`.ps-cb-in.r` — broker fee / commission), the closed-view amounts (`.ps-cb-amt`), and the "Chargebacks total" figure (`.ps-cb-sub`). Neutralized: `.ps-cb-in` text → `--ink`, borders → `--rule2`; `.ps-cb-title .sub`, the `.ps-adj-hdr`/`.ps-padj-hdr` column headers (inline red removed → `--ink3`), the empty-state, the note columns, the "+ Add a chargeback" button, and the × delete (now `--ink3`, hover `--flag`). Applies to Sophia's editable section and the producer mirror.
- **Checks/ACH Commissions section:** keeps its **gold band** (`#f7ecd9`) but the figures now read **black** (`#1a1a1a`) — amount inputs, closed-view amounts, and the "Checks/ACH commissions total" — to match the new light total bubbles. The "Commission" column header dropped from gold to `--ink3` (matches the sibling headers). NOTE: this supersedes the earlier m0033 "everything in Checks/ACH should be gold" — once the totals became light-fill + black-text, Sophia wanted the line items to follow (gold tint = identity, black text = legible/consistent).

## Total bubbles → light band-color fills with black text (June 24, 2026, v14)
Sophia: each total bubble should be filled with the **same light color as its column band**, with **black letters** — except **Grand Total Income, which stays the bright filled card**. So 4 of the 5 `.ps-tot.c-*` cards flipped from saturated-fill/white-text to light-tint-fill/black-text: Total Broker Fees = `#e8f1fb` (exact broker band), Total Commissions = `#e7f6ee` (exact commission band), Checks/ACH = `#f7ecd9` (exact Checks/ACH band), Total to Pull from Trust = `#ece8f8` (trust has no column band, so a light tint of its purple identity). Each keeps a 4px left border in its saturated hue so the color identity still reads. Grand Total Income unchanged (`--accent` forest fill, white text). Applies on both the pay sheet and the print cover (shared classes).

## Label-vs-money color separation + shorter 1st-yr tag (June 24, 2026, v14)
Sophia's rule, stated plainly: **money items = bright/saturated "primary" colors; labels = pastel, kept as far from the money hues as possible.** Her example of the problem: transaction "New" was pastel green while the Commission dollar column is also green.

- **Money keeps the saturated hues (unchanged):** broker = blue `#2f6fb0`, commission = green `#1f8a5b`, trust = purple `#6b4fbb`, Checks/ACH = gold `#c0852d`, grand = forest `--accent`, chargebacks = red `#e0352b` (totals are filled bright cards; broker/comm/Checks-ACH are tinted column bands; chargebacks bright red).
- **Label chips (account type + transaction type) recolored into the GAPS** of that palette — none now sit on blue/green/purple/gold/red/forest. Account: House = teal `#1f6b78`, **book = rose `#9d3f6b`** (was blue), **1st-yr = mauve `#84406f`** (was orange). Transaction: **New = cyan `#15707f`** (was green — the reported clash), **Renewal = warm-stone `#6e6450`** (was purple), Endorsement = slate `#3f4f73` (kept), **Audit = teal `#1c6e62`** (was gold), Cross-sale = cyan `#0c7a88` (kept), Rewrite = pink `#a32c68` (kept). These are shared `tag-*` classes so the **ledger gets the same label colors** (consistent; the same green-New/green-commission clash existed there too).
  - Constraint reality (logged so it isn't re-litigated): the money palette occupies blue/green/purple/gold/red/forest, leaving essentially only **teal/cyan, rose/pink/mauve, and warm-neutral** as "safe" label families. 9 labels can't all be uniquely hued AND clear of money, so a couple of safe hues repeat across the two columns (e.g. teal on House-account & Audit-txn; cyan on New & Cross-sale). They sit in different columns and are text-labeled, so it reads fine; the saturation/lightness contrast (bright money vs pastel label) is the primary money-vs-label separator, per Sophia's own framing.
- **Shortened the 1st-yr-house account chip** from `{name} · 1st-yr house` → **`{name} · 1st Year`** (e.g. "Kaylee · 1st Year") so the tag isn't so wide. `acctTagHTML` only; the account-section header still reads "1st-yr house."

---

- **Policy-type column is PLAIN TEXT on the pay sheet** (Sophia's request) — rendered as normal `var(--ink2)` text like the insured name, not a chip. The Sophia/producer row cells call `bEsc(p.poltype)` directly instead of `polTypeChip()`. Removes any total-hue collision automatically (no colored pill) and reads quietly as the last column. **The ledger keeps its color-coded `pt-*` chips** (`polTypeChip` unchanged; only the pay-sheet cells bypass it). Superseded the earlier neutral-pill approach (that CSS rule was removed).
- **Checks/ACH amount column now reads GOLD** — `#f7ecd9` band + `#a8701f` text on the amount cell across header + every row (`.ps-back-wrap .ps-dd-row > *:nth-child(3)`), matching its gold Checks/ACH total card. This is the parity Sophia asked for: the main-row Commission column is a green band → the Checks/ACH amount column is a gold band. (It was already gold text; the change is the continuous column band.)
- **REVERSED the May 30 "Sophia's actual take-home" footer row** (removed it + its `setv('tot-take-…')` in-place update; `sophiaShareTotal` still computed, just not displayed). Original rationale (May 30): disambiguate that the columns show full agency gross, not her 75%. Sophia (owner) overrode it June 24: the figure is **misleading** because it excludes Checks/ACH commissions, so it isn't truly her take-home, and she doesn't need it. The column headers + account chips already make ownership clear. Budget still pulls `grandTotal`/Grand Total Income — unaffected.
- **Agency-KPI count breakdown — considered then dropped.** Sophia asked for agency-level counts (new/renewal/1st-yr house/work-comp/bonds/new-house-vs-new-producer) on the KPI overview, then **retracted** it once she saw the print agency report already carries the Activity + By-account-type breakdown. Not built. (If revived: work-comp/bonds/new-house-vs-new-producer counts are NOT yet on the cover — would add a counts-only `kpiAgencyMixHTML(recs)` shared by `kpiCompanyHTML` + `agencyCoverHTML`, agency-only.)

**Regression (live data, post-edit):** `renderPaySheets()` clean; Trust = Broker + Commission and Grand = Trust + Checks/ACH still hold; all 5 total cards render. Column order confirmed in the DOM.
- **Alignment fix (same day, post-verifier):** the reordered Sophia/producer grids used bare `fr` tracks, whose implicit `min-width:auto` let a long `nowrap` policy-type chip (e.g. "BOP - Business Owners Package") stretch the last track on DATA rows only — header vs data drifted up to 53px and the blue/green bands slid off their headers. Fixed by switching every track to `minmax(0,…fr)` in all three Sophia grids (`.ps-row-hdr-sophia,.ps-row-sophia` + `.ps-totals-row.sophia`) and both producer grids, and adding `white-space:normal` to the pay-sheet policy-type chip so long names wrap inside the fixed last cell instead of stretching it. Verified: 0px header/data drift on both sheets even on the longest policy name.

---

**Branded running footer (print only) + page-number note (June 24, 2026, v14).** `_ensurePrintFooter()`/`_removePrintFooter()` inject a `position:fixed;bottom:0` footer — **“West Coast Insurance Brokers · {Month Year} · prepared {date}”** — that repeats on every printed page of BOTH the full agency report and a per-agent print, so output looks intentional instead of showing the browser’s file-path footer. `@page{margin:12mm 12mm 16mm 12mm}` reserves bottom room; hidden on screen; removed on cleanup/`afterprint`. **Page numbers:** Sophia liked “Page 3 of 7,” but Chrome’s Save-as-PDF does NOT render CSS page-counters in a normal/fixed element (the `@page @bottom-*{counter(page)}` margin boxes are unsupported in Chromium), so auto page numbers can’t live in our own footer — the reliable source is the print dialog’s **“Headers and footers”** checkbox (left as a user choice). Page break confirmed **one agent per page** (Sophia may span several pages) per Sophia.

**IdealTraits added → Annual Subscriptions (reference only).** Employee hiring platform; **$999, renews Oct 1 2026, NOT on auto-pay** (Sophia pays the renewal manually). Seeded in `budgetTemplate.annual` + added to open months via migration `from < 20` (template + open months only; archived/closed May untouched — verified). Reference-only so it never inflates monthly totals; the existing `renewMonth` mechanism fires the **October** renewal reminder automatically (“⚠ Renews this October — add to Business Monthly Subscriptions”). `autopay:false`. Verified live: present in June annual as `IdealTraits | $999 | renews October | autopay:false`.

---

---

## Pay-sheet color system, grouping, money/date formatting (June 24, 2026, `wcib_dashboard_v13.html`)
Sophia wanted the pay sheet far more visual + easier to scan, consistent into KPIs.
- **Chip color system** (crisp = light tint bg + bold saturated text + border; NOT filled-white which rendered fuzzy). `acctTagHTML` (Account type: House teal / “Producer · book” blue / “Producer · 1st-yr house” orange), `txnChip` (Transaction: New green / Renewal purple / Cross-sale teal / Audit amber / Endorsement slate-blue / Rewrite rose), `polTypeChip` (Policy type: GL blue, Inland Marine teal, WC green, Excess purple, BOP violet, Garage amber, Landlord orange, Pollution olive, Bond slate, default gray). Bright red is reserved exclusively for negative/chargeback numbers.
- **“My account” → “House”** per Sophia (agency house accounts). Distinct from producer “1st-yr house”.
- **Added the missing Policy type column to Sophia’s sheet** (she only had it on producers). Sophia cols now: Insured | Broker fee | Commission | Policy type | Account type | OV. Producer cols: Insured | Policy type | Account | Payout.
- **“Txn type” relabeled “Transaction”** and (per the next ask) turned into the **sub-group header** rather than a column. Sheets now group **Account type (outer) → Transaction (inner)**, each with a count; the separate Transaction column was dropped on both sheets.
- **Broker fee & Commission columns highlighted** (light blue / light green) matching their total cards (`.ps-col-broker`/`.ps-col-comm`, full-height band via negative margins). Checks/ACH “Commission” column color-matched green to the commission column.
- **KPI color cross-ref**: New/Renewal/house/book cards get `kc-*` left borders in the same palette; new **“Activity by transaction type”** section (`kpiTxnTypeHTML`) shows count+revenue per transaction with the same chips. (KPIs only populate from CLOSED sheets — 0 closed now, so the page is empty until June closes; nothing was lost.)
- **Global money format**: `fmt` now shows whole dollars with no decimals ($1,000) and keeps cents only when present ($1,000.05); commas/$ automatic; propagates to `fmtRemaining`/`fmtVar`/inputs/`fmtCB`. Money inputs (incl. Checks/ACH) auto-format to a dollar amount on blur.
- **Date auto-format** `toSlashDate`: a pure 5–8 digit run → MM/DD/YYYY (06102026, 6102026, 061026, 61026 all → 06/10/2026); 2-digit years → 20YY; anything with / or letters left alone. All system date displays use `fmtDate` (Mon D, YYYY); fixed the producer rate note that printed raw YYYY-MM-DD.

**STILL OPEN (next focused task): the print/PDF rework Sophia asked for** — ✅ DONE in v14 (see the top entry: `printAgencyReport()` + company-summary cover + print-bug fixes + print-color-adjust:exact).

---

---

## Chargebacks rework — red, auto-negative, producer auto-mirror (June 24, 2026, `wcib_dashboard_v13.html`)
Sophia's asks on the Adjustments section: (1) make chargebacks stand out — separate + bright red; (2) when a chargeback is assigned to a producer (e.g. Kaylee 1st-yr), claw back the producer's share as a negative on THEIR sheet (bold/red/separate, visible when she prints theirs); (3) amounts here are always negative; (4) look like the pay-sheet layout but red/white.

- **Auto-negative.** `setAdjustment` now stores `-Math.abs(parseMoney(val))` for broker/commission/payout — any amount typed becomes a subtraction. Amount inputs reformat to the signed value on commit. Display uses `fmtCB(n)` → `−$1,234.56`.
- **Red, set-apart section.** Renamed to **"⚠ Chargebacks & Adjustments"**, restyled `.ps-cb-*` (red border/top-bar, `#fdf3f2` bg, `#e0352b` accents, red inputs), margin to separate it. The 5-total cards still net it (Trust/Grand reflect the subtraction); a red **"Chargebacks total: −$X"** subtotal shows in-section (`#cbsub-${sid}`).
- **Producer auto-mirror.** `rebuildProducerMirrors()` reads Sophia's open-sheet adjustments whose `basis` is `book::Name`/`house::Name` and writes **read-only** mirror entries (`_mirror:true`, `_mirrorOf`) onto that producer's OPEN sheet, `payout = producerShareOfAdj()` (producer's renewal-tier rate × the negative broker/commission → negative; exact for flat-rate Kaylee). Folds into `computeSheetTotals` producer payout automatically. Producer sheet shows a read-only red **"⚠ Chargebacks"** section (hidden when none) + "(incl. chargebacks)" on the grand-total label. So the agency absorbs 100% of a chargeback split correctly: Sophia 75% (her `sophiaShareTotal`), producer 25% (their payout). Closed sheets keep snapshotted mirrors (rebuild only touches open sheets).
- **Tab-safe.** `setAdjustment` updates Sophia totals in place AND `refreshProducerMirrorsDOM()` updates each producer's mirror list (`#cbmirror-${sid}`) + payout totals in place — no full re-render, so Tab still flows. `add/removeAdjustment` rebuild mirrors then full-render (structural).
- **Verified** on Sophia's live data: ABC Construction (comm −$87.50, basis house::Kaylee) → Kaylee mirror −$21.88, her payout $2,166.52→$2,144.64; Sophia take-home absorbs the 75%; agency Trust nets the full −$87.50. NOTE: Sophia had cleared the 3 migrated corrections (Pacific NW/C&J/B&G) during testing — only ABC remains in adjustments now (her edit, left as-is).

---

---

## Pay-sheet manual-entry sections, display & UX fixes (June 24, 2026, `wcib_dashboard_v13.html`)
All in the pay sheet (`renderSheetBody` / `computeSheetTotals`).

**Adjustments & Chargebacks (Sophia sheet).** New `sheet.adjustments[]` `{id,date,insured,poltype,basis,brokerFee,commission,payout,note}`. Manual line for chargebacks / returned commission / corrections; broker & commission accept negatives. Folds into Total Broker Fees / Commissions / Trust / Grand (and Sophia's 75/25 share via `basis`: `own`=100%, `book::Name`/`house::Name`=75%). **Stays out of the Ledger and KPIs** (the whole reason — faked negative "policies" polluted KPIs). CRUD: `addAdjustment`/`setAdjustment`/`removeAdjustment`/`adjBasisOptions`/`adjBasisLabel`. Migrated the 3 imported corrections (Pacific NW Drywall −87.50 comm, C&J −65 broker, B&G Dymatize −189 broker) **out of the ledger into adjustments** — totals identical (Broker 32,627.66 / Comm 18,291.18 / Trust 50,918.84), ledger 62→59 real policies.

**Producer payout adjustments.** Same `adjustments[]` on producer sheets, single `payout±` field; folds into `totals.payout`. So a Kaylee-account chargeback can claw back her 25% on her own sheet.

**Checks/ACH Commissions ("from the back").** Renamed the old "Direct Commissions / Checks to Biz Savings" → **"Checks/ACH Commissions"**, relabeled the payer column **Client name → Insurance company**, and **repositioned it to the bottom of Sophia's card** (after totals, before the Kaylee section) per Sophia's Excel sheet-2 layout. Still `sheet.directDeposits[]` summing into Total from the Back → Grand Total Income → budget gross income. The 5th total card relabeled "Total from the Back" → **"Checks/ACH Commissions"** to match. Sophia's June: 4 entries (SAIF 5,217.97 / ACIC 600 / Geico 1,266.46 / Progressive 7,477.94 = 14,562.37) → Grand Total Income **65,481.21**, budget income tracks it.

**Producer "Basis" → "Txn type" (display fix).** The producer sheet collapsed every non-New txn to "Renewal" (rate-tier label), so Kaylee's book looked like 4 renewals. Now shows the **actual** transaction type (Cross-sale / Renewal / Renewal / Audit) to match the Excel + Sophia's sheet. Rate logic unchanged (still New-vs-renewal tier internally).

**Tab-safe editing (UX bug).** Field edits in these sections used to call `renderPaySheets()` (full DOM rebuild) on every `onchange`, destroying focus mid-Tab. Now `setDirectDeposit`/`setAdjustment` update only the totals text via new **`refreshSheetTotalsDOM(sheetId)`** (totals carry `tot-bf/cm/trust/back/grand/take/achsub/payout-${sheetId}` IDs); input rows are never rebuilt, so Tab flows. `add*`/`remove*` still re-render (structural).

**Date auto-format.** `toSlashDate()` on the date inputs: a pure digit run formats on blur/Tab (8→MM/DD/YYYY, 6→MM/DD/YY); anything already containing `/` or letters (e.g. "6/1/2026", "Jun 3") is left untouched.

**Kaylee rate reset to 25%.** Sophia had bumped Kaylee's rate to 50% (history entry dated 2026-06-23) while testing. Removed the test entry, leaving the 25/25/25/25 baseline (eff. 2024-01-01). June is open so payouts recomputed live to 25% (her total $2,166.52; PNW Prestige renewal = 25%×(325+1000.45)=331.36). Helper kept only entries that are 25 across the board.

---

---

## June 2026 pay-sheet import + pay-sheet totals restructure + "from the back" section (June 24, 2026, `wcib_dashboard_v13.html`)
Sophia provided her June Excel pay sheet (`uploads/06 - June 2026 Paysheet.xlsx`, 2 sheets). Goal: get an accurate June pay sheet in the dashboard to cross-check against her current system. All 6 of her confirms answered (see below).

**Pay-sheet totals restructured (Sophia sheet) into 5 color-coded totals**, matching her Excel exactly:
- Total Broker Fees (Σ broker) · Total Commissions (Σ comm) · **Total to Pull from Trust** (= broker + comm, = the old "agency gross") · **Total from the Back** (new) · **Grand Total Income** (= Trust + Back).
- `computeSheetTotals` now also returns `fromTheBack` + `grandTotalIncome`; stored on close (with fallbacks for old closed sheets).

**New "Direct Commissions / Checks to Biz Savings" manual section** on Sophia's sheet (cols: Date paid out · Client · Commission), stored as `sheet.directDeposits[]`. These are ACH/checks deposited straight to business savings (NOT from the client trust). Their commission sum = "Total from the back." Add/edit/delete via `addDirectDeposit`/`setDirectDeposit`/`removeDirectDeposit` (open sheets only; read-only when closed). Empty now → $0.

**Budget gross income now = Grand Total Income (Trust + Back).** `resolveBudgetIncome` (paysheet source) uses `grandTotalIncome` for both the live (open) and locked (closed) figure. Confirmed: June budget gross income binds to $50,918.84 (provisional).

**Import (62 policies, June 2026):** wiped sample Ledger/Approvals/Drafts/Pay-Sheets (kept Budget, staff, MGA list, carriers, Settings), then entered every Sheet-1 row as an **already-approved + MGA-paid** ledger entry routed through `addPolicyToPaySheets`. Result: Sophia's June sheet = 62 policies; Kaylee's = 12. Totals: Broker $32,627.66 · Commissions $18,291.18 · Trust $50,918.84.
- **Kaylee attribution** (cross-referenced Sheet 1 "Kaylee" flag vs Sheet 2 "Kaylee Accounts" list): **book** = PNW Prestige (×2), Superior Framing, Tree Talk (4). **1st-yr house** = CJ Construction (×2), Timberline (×2), Roofex (×2), Welfare, Viva (8). Kaylee's rates are 25/25/25/25, so her 25% payout matches the Excel column-F amounts. Producer='Kaylee', kaylee='book'/'house'; everything else producer='', kaylee='none' (Sophia's own).
- **Confirms applied:** (1) entered with only client/broker/commission/ins-type/txn-type/attribution — base/amount-paid/MGA left blank (already settled, won't hit MGA Payables); (2) TBP/TBD commissions (Viva, Guzman, Roofex-WC, KEN, Odyssey = 5) entered as **commMode='tbd', $0** (carrier mails the check later → will land in "from the back"); (3) the 3 corrections (Pacific NW Drywall −87.50, C&J −65, B&G −189) entered as **negative adjustments** with note text; (5) wipe-first; (6) ins-type shorthand mapped to real policy types where confident (GL→General Liability, IM→Commercial Inland Marine, WC→Worker's Compensation, XS→Excess Liability, BOP→BOP - Business Owners Package, Garage→Garagekeepers, Landlord, Pollution→Pollution Liability, WABond→Bond - Washington Contractor) — **bonds kept as shorthand** (Residential/OR/Commercial/S/U Bond) since the graduated $ amount is unknown.
- **Next (Sophia):** review against her current system; tomorrow run a fresh check-in through the full flow (check-in → approve → MGA payout → her pay sheet → budget), then close June to lock income + populate KPIs.

---

---

## Back up / Restore + scroll-following reminder (June 24, 2026, `wcib_dashboard_v13.html`)
Context: Sophia wants to use the budget on her laptop AND office computer and keep all prior months. Explained the catch — data lives in **localStorage per-browser/per-machine**, so the `.html` on OneDrive carries the *program*, not the data. Decision (bridge until the hosted build): a portable data file.
- **`exportAllData()`** writes one `WCIB-data-YYYY-MM-DD.json` (all `STORAGE_KEYS` + `wcib_v9_bdgcollapse`, with `meta`: # months / ledger / pay sheets) she keeps in OneDrive. **`importAllDataFromInput()`** validates `kind:'wcib-backup'`, shows a confirm with the file's date + counts, writes every key, and `location.reload()`s. Tracks `wcib_v9_lastbackup` {at, sig} where `sig`=summed length of all keys (cheap dirty-check).
- **Fixed backup reminder** (bottom-right, `position:fixed` so it follows scroll on every tab), **admin-only**, session-dismissible (`×`). Shows "Never backed up" / "Changes since last backup (N days ago)" in pulsing red when pending, or "Backed up N days ago · up to date" muted. Refreshed on every `showPage` + a 20s interval. Mirrored as a **Settings → "Back up & restore"** section. Matches the app's existing token vocabulary (reused `bbRemindPulse`), not the external design system, per the "follow the host UI" rule.
- **Strategy advice given:** Sophia is leaning toward telling Ennis to do **two separate builds** (operational vs. financial), reasoning same cost. Endorsed — cleanest enforcement of "employees never see financials" — with two caveats to raise with him: (1) ask if the two apps can share one login + one hosting account to avoid double infra/maintenance cost; (2) the only cross-app dependency is the single monthly **total-sales** number (+ later the office list). The hosted financial app is the real fix for "access from any computer"; the JSON backup is the bridge until then and doubles as the seed/import file for the hosted version. Offered to update `Email_to_Ennis.md` to the two-build plan (pending Sophia's go-ahead).

---

---

## Data-driven properties, Settings tab, per-rental income, manual income, office-location KPIs (June 24, 2026, `wcib_dashboard_v13.html`, BUDGET_SCHEMA → 19)
Goal (Sophia): make the budget adapt as the business grows over the next decade with **no code edits** — properties were hardcoded in ~95 spots. v12 copied to v13 first (v12 preserved). Standalone-HTML / top-level-`let` / BUDGET_SCHEMA+migrateBudgets / test-harness architecture all kept.

**Properties are now a data-driven list.** `propertyList = [{id,label,kind,archived}]` (seeds: roshak=home, uplands=office, blueberry=rental) drives every Property dropdown, the closed-month tags, `computeBudgetTotals.propertyTotals`, the By-property panel, the Operating-View books, and CSV — nothing hardcoded. `kind` drives behavior: **home → Personal book · office → Business book · rental → its own Operating-View book + its own top-of-Budget rent-income box + net** (decided with Sophia). Helpers: `propsActive/propById/propLabel/propKind/propsRental/isRentalProp/propertyOptionsHTML/officeProps/defaultOfficeId/multiOffice`. New storage key `wcib_v9_properties`.
- **Property control widened on Hard Bills:** the Property dropdown now shows on **all** Hard Bills + Employees (was: only the 3 named mortgages). Deliberate reversal of the schema-13 restriction — needed so a new property's utilities AND mortgage can be tagged for per-property cost tracking.
- **operatingBooks** now builds Business + Personal + one `rental:<id>` book per rental (active, or archived-with-data). Routing: rental property → its book; home → personal; office → business; else falls back to the line's scope. renderOperating summary + book list iterate dynamically (one net card per rental).

**Per-rental income.** `b.rentalIncome` migrated from a scalar (Blueberry only) to a **map `{propId: amount}`**. One bright-red “enter this month” income box renders per active rental at the top of Budget (`renderRentalIncomeBoxes`); `setRentalIncome(pid,val)` / `rentalBlur(el,pid)`. `rentalIncomeMap()/rentalIncomeTotal()` tolerate the legacy scalar. `otherIncome` = sum across rentals; Remaining/remainingAllIn math unchanged.

**Manual “total sales” income (decouples Budget from the Pay Sheet).** Per Sophia's plan to keep the financial half local/standalone: the Gross-income box has an “✎ enter total sales manually” toggle (`toggleIncomeMode`/`setManualIncome`/`manualIncomeBlur`) that flips a month to `incomeSource:'manual'` (the existing manual mode historical months already use) and back to Pay-Sheet binding. **Default for new months is unchanged (paysheet)** — manual is opt-in. KPIs intentionally stay on the operational side (they need per-policy snapshots, not one number).

**New admin “Settings” tab** (top-level, admin-only — Sophia's pick). Sections, all live-editing template + open months (archived untouched), persisted:
- **Properties** — add / rename / change kind / archive. Archive = hidden from new dropdowns but kept (greyed) on months where already used.
- **Credit cards** — the roster IS the `cc` budget-category lines; added an editable **`last4`** field. Bills still map by the stable card **name**, so a reissued card = edit last-4 in one place, no mappings break (Sophia asked for this twice). Add/rename(+rewrites chargedTo refs)/archive(removes from template+open months).
- **Bank/draft accounts** — `payAccountList=[{id,label,number,archived}]` replaces the `PAY_ACCOUNTS` constant (new key `wcib_v9_payaccounts`). Bills map to the stable **label**; `number` is display-only/editable. “Charged to” picker + By-card panel now show `name ••last4` / `label ••number`.
- **Budget categories** — **rename only** (label override in `budgetCatLabels`, key `wcib_v9_catlabels`, via `budgetCatName`). Behavior stays fixed (only hard/cc/emp/payables count toward Total expenses; annual reference-only) — Sophia was unsure about adding categories, so deferred; adding a category would require choosing its behavior per-category.

**Office-location revenue tracking (KPI side only).** Sophia: as she opens new offices she wants per-location revenue insight. An office location = an `office`-kind property. Every Check Turn-In stamps `officeId`; the form's **Office picker appears only when 2+ active offices exist** (`renderOfficeField`/`selectedOfficeId`) — today it auto-stamps Uplands with no UI. `officeId` carried into the live records + the closed-sheet `policySnapshot`; the **company KPI view gains a “Revenue by office” card row** (`kpiByOfficeHTML`, hidden until 2+ offices, with an “Unassigned” bucket). Legacy check-ins (ledger + queue) backfill to the default office on hydrate. **No other screen changes** — analytics-only, per Sophia. NOTE: this is the one place the (eventual) local financial app + server operational app share config (the office list).

**Migration `from < 19`** (idempotent): seeds property/account/catlabel storage if absent; normalizes every month's `rentalIncome` scalar→map (incl. archived — type-safety); rewrites old account “Charged to” strings (“Operating Biz account 9889” → “Operating Biz account”) so editing a number can't break a mapping; adds `last4:''` to every cc line. Verified on Sophia's real saved data: $3,500 Blueberry rent preserved, accounts relabeled, books = business/personal/rental:blueberry, schema 19, all Settings/Budget/Operating renders clean. Multi-office paths dry-run-tested (picker shows, KPI splits Uplands/Westside/Unassigned, office line folds into Business book).

**Regression (re-confirmed):** Total expenses = Hard Bills + Credit Cards + Employees + Business Payables only; Remaining = gross income − Total expenses (rental income excluded); Operating View net-all-in = (income + rental) − (business+personal actual). `computeBudgetTotals` math unchanged by the refactor.

**Still open / next (Sophia, June 25):** enter the real June pay-sheet list as already-MGA-paid settled policies (push through check-in→approve→mark-paid, not faked rows) after a Start-Fresh wipe of sample Ledger/MGA/Pay-Sheet data; then test the full flow end-to-end (unpaid check-in → MGA payout → self pay-sheet → budget) and cross-reference fields against her current system.

---

---

## Bug pass + extensibility assessment (June 24, 2026, `wcib_dashboard_v12.html`, schema 18)
**Bug pass — clean:** all 11 pages render without errors; Total expenses = the 4 bill categories; Remaining = pay-sheet gross − Total expenses (Blueberry excluded); credit-card payoff, income reminder, paid toggles, CSV export all working; no console errors.

**Extensibility status (for the NEXT chat / future build):**
- ✅ Already user-addable: **bills** (+ Add item, recurring carries forward), **credit cards** (add a line in Credit Cards → shows in "Charged to").
- ❌ NOT user-addable — hardcoded, needs a data-driven refactor:
  - **Properties** (roshak/uplands/blueberry) are hardcoded in ~95 spots: `propertyTotals` object, the Property `<select>` options, label maps (`{roshak:'Roshak',…}`), `operatingBooks`, `renderBudgetBreakdown`, and migrations. Adding a 4th property (e.g. a new rental) currently requires code edits everywhere.
  - **Categories** (`BUDGET_CATEGORIES`), **bank/draft accounts** (`PAY_ACCOUNTS` constant), and **card management** (rename / update last-4 on reissue) are also code-level only.
- **Queued for next chat:** refactor properties into a data-driven list (`properties: [{id,label,kind}]`) that everything derives from, + a **Settings area** to add/rename properties, cards, accounts (and ideally categories). Preserve archived months; schema bump + migration; copy v12→v13 before the refactor.

---
- **Business Monthly Subscriptions: due-date control removed** on all lines (they're auto-pay; due date irrelevant). `dueCtl` now also excluded for `misc`.
- **Vistage moved** from Business Payables → Business Monthly Subscriptions (migration `from < 18`, template + open months).
- **Personal expense detail location:** the budget-page "Operating costs & net" panel shows only the personal *total*; the line-by-line personal breakdown lives in the **Operating View tab → "Personal — incl. Roshak home" book**. Confirmed Sophia just needs to open that tab.

---

## Card roster — names, last-4, and bill mappings (June 23–24, 2026; gathering, NOT yet entered into dashboard)
Sophia is identifying every card/account card-by-card so bills can be tagged with the right "Charged to". **Correction:** the First Tech numbers 6651 / 4896 she gave first were ACCOUNT numbers, not card numbers — use the card numbers below.

**Confirmed cards:**
- **Sapphire •3705** → Renew Aesthetics ($99, personal, 17th), Sundance Marina ($68.15, personal, 20th). *(Renew Aesthetics was earlier said to be Visa •6578 — now Sapphire; •6578 likely retired, confirm.)*
- **Alaska •5496** → Everything Websites (website host, $100/mo, business).
- **FTCC Cash •0293** (First Tech Mastercard cashback) → QuickBooks ($38, 12th), Comcast/office internet ($85, Uplands), PGE Roshak+Uplands (~$90), Massage Envy (personal), Recology/Blueberry garbage (~$170), Waste Mgmt/Roshak garbage (~$220), Tualatin Valley Water/Roshak (~$110), Tualatin Valley Water/Uplands (~$130).
- **FTCC-World •0196** (First Tech World) → Astound/Blueberry WiFi ($101.92), Primo Water/office (~$150), ChatGPT ($20, personal), Daphne's counseling ($220, personal), Ziply office ($130, 28th), Ziply Roshak ($115, 28th), City of Sheridan water/Blueberry (~$113, 15th). *(Bills originally cited under both old •4896 and •0196 — confirm all belong to FTCC-World.)*
- **Amex •1008** → these auto-pays (per Sophia, Jun 24): **DocuSign**, **RingCentral** (~$400), **IT Solutions** (formerly "IT Company" — just rename to IT Solutions; amount TBD), **Agency Zoom** ($279.20), **ChatGPT** ($20), **Now Certs** ($99), and **Medford Builders Exchange** ($150, end of month). *(Reassignments: Now Certs was earlier Visa •0129; ChatGPT was earlier FTCC-World. DocuSign is the annual line — autopay now on Amex.)*
- **Coinbase •3835** → **Wispr** (annual $864, next renewal Jun 19 2027).
- **Alaska** (no last-4 — Sophia: just call it "Alaska") → **Vistage** ($1,855, 20th) + **Everything Websites** ($100, website host). (Resolves the •5496/•0129 confusion — it's one card labeled simply "Alaska.")
- **IT Solutions** (rename of "IT Company") = **$1,134/mo**, on Amex •1008.
- **FTCC Cash •0293** confirmed bills: QuickBooks ($38), Comcast/office internet ($85), **Massage Envy ($90/mo — amount now known)**, + PGE/Waste Mgmt/Recology/Tualatin Valley Water per earlier.
- **Cabela's •928** (Tracy's; home/Blueberry purchases) → nothing on auto-pay.

**Claude (decided Jun 24):** annual membership ($1,652.40, renews May 27 2027) → **Annual Subscriptions** (reference only). Separate monthly **"Claude — AI Tokens"** line = **$500/mo** → **Business Monthly Subscriptions**.
**FTCC last-4 RESOLVED (Jun 24):** FTCC Cash = **•0293**, FTCC-World = **•0196** (the 6651/4896 first given were account numbers).
**Still TBD (Sophia to return):** confirm Alaska card number (•5496 vs •0129); Chloe's future card (deferred).

---

## "Total expenses" = bills only + Blueberry-income red reminder (June 24, 2026, `wcib_dashboard_v12.html`)
- **Total expenses (Budget view) now sums ONLY Hard Bills + Credit Cards + Employees + Business Payables.** Per Sophia: Monthly Subscriptions, Intertwined, Annual, and Income are **data only** — shown, and still included in the P&L/scope/property rollups + Operating View, but **NOT** in the headline Total expenses / Remaining (the money-to-set-aside figure). Implemented in `computeBudgetTotals` (grand totals gated to those 4 categories; scope/property still include misc/inter for the micro-P&L). Summary note now reads "budgeted X · bills only."
- **Blueberry income box turns solid BRIGHT red** (#ff1f1f fill, bold white text, ⚠ chip, gentle pulse) while empty, reverts to neutral once an amount is entered — a can't-miss reminder to enter rent each month. (Sophia asked for a true bright red, not the muted `--flag`; this is a deliberate, user-requested exception to the muted palette.)

### Remaining / income calc (confirmed by test, Jun 24)
- **Gross income (pay sheet)** and **Blueberry income** are both data pieces. The headline **Remaining** (top of Budget tab) = **pay-sheet gross income − Total expenses** (the 4 bill categories). **Blueberry income does NOT feed Remaining** — verified: +$524.77 when gross 60k/bills 59,475; −$49,475 when gross 10k.
- `computeBudgetTotals` returns **`remaining`** (= income − bills, for the top box) and **`remainingAllIn`** (= pay-sheet + Blueberry income − all operating costs excl. credit-card payments, used by the “Operating costs & net” panel + Operating View “Net (all in)” so the micro-P&L stays complete).

**Feature queued (Sophia asked twice):** card management — store each card's **name + last-4 separately**; bills map to the stable card **name**, so when a card is reissued with a new number she edits the last-4 in one place and no bill mappings break. Part of the deferred Settings build.

**Status:** none of these entered into the dashboard yet — pending completion of the card list + a few amounts/cards, then a card-by-card build.

---

## Business Subscriptions + Payables → single "Amount due" column (June 23, 2026, `wcib_dashboard_v12.html`, BUDGET_SCHEMA → 17)
- **Business Monthly Subscriptions** and **Business Payables** now use one **"Amount due"** column (like Employees) — Actual + Variance hidden. These are fixed recurring charges; Sophia shouldn't re-enter budgeted vs actual each month. `editBudgetLine` mirrors `actual = budgeted` for `misc`/`payables` (and `emp`) so the single number flows into all totals. Migration `from < 17` mirrors existing months (amount = budgeted, else actual; preserves notes/autopay/etc — does NOT touch her manual edits).
- Single-amount categories now: **emp, misc, payables, annual** (annual stays reference-only). Header labels: Employees "Monthly (est.)", Subscriptions/Payables "Amount due", Annual "Annual $", Credit Cards "To pay off"/"Paid"/"Carried".
- **Carry-over:** these amounts persist via the recurring template and stay the same month to month; editable per-month if needed.

---

## Annual Subscriptions (reference-only) + meta overlap fix (June 23, 2026, `wcib_dashboard_v12.html`, BUDGET_SCHEMA → 16)
- **New "Annual Subscriptions (reference only)" category.** Holds annual subs (e.g. DocuSign) so they're NOT calculated into monthly totals/remaining/scope/property/by-card/Operating View — excluded everywhere (computeBudgetTotals returns early for `annual`; by-card + operatingBooks skip it). Its own category total still displays, labeled "annual total · reference only."
- **Per-line "Renews" month** (new `renewMonth` field, replaces the Property slot in the meta grid for annual lines; Due is hidden, Type/Charged to/Auto-pay kept).
- **Renewal reminder:** in the month an annual sub's `renewMonth` matches the open month, the Annual category shows a red banner — "⚠ Renews this [Month] — add to Business Monthly Subscriptions: [name] ($amt)" — plus a standing "reference only" note. (Sophia's intent: see annual costs + when they hit, without them inflating monthly budgeting.)
- **DocuSign moved** from Business Monthly Subscriptions (was a $269/mo reserve) to Annual at its true **$3,228/yr, renews June**. Migration `from < 16` moves it in template + open months.
- **Meta overlap fixed:** the per-line meta grid columns widened (150/160/250/80/104) and `.bdg-charged` select set to flex within its cell, so "Charged to" no longer overlaps "Due" in Business Payables.

---

## Employees single-amount, New Employee line, meta alignment (June 23, 2026, `wcib_dashboard_v12.html`, BUDGET_SCHEMA → 15)
- **Employees = one amount, not Budgeted/Actual.** Sophia doesn't know true payroll until month-end; she just needs an estimate to fund the payroll account (leftover stays as cushion). The Employees category now shows a single **"Monthly (est.)"** column (the Budgeted field); Actual + Variance columns are blank for emp rows. Internally `editBudgetLine` **mirrors actual = budgeted for emp** so Operating View / scope / property rollups still reflect estimated payroll. Migration `from < 15` sets actual=budgeted on all emp lines.
- **Floating "New Employee" line** added to Employees (default **$0**, recurring). Purpose: when planning a hire, budget ~3 months of wages here before hiring. Seeded in template + added to open months via migration.
- **Meta controls grid-aligned.** The per-line meta row is now a fixed 5-column grid (Type · Property · Charged to · Due · Auto-pay); absent controls render an empty cell so auto-pay and due-date line up vertically across rows even when a line has no "Charged to" (e.g. WorldMark). Read-only (closed-month) meta stays flex-wrapped tags.

---

## Credit-card payoff UX, column reorder, Roshak spelling, name carry-over (June 23, 2026, `wcib_dashboard_v12.html`, BUDGET_SCHEMA → 14)
- **Credit Cards get a tailored row.** Columns relabel to **To pay off** (statement balance, = `budgeted`) / **Paid** (= `actual`) / **Carried** (balance − paid: “paid off” green when ≤0, else red amount that rolls over). A **✓ Paid off** button copies the full balance into Paid in one click (`payoffCard`). `refreshBudgetTotals` is CC-aware so the Carried cell updates in place.
- **Variance/Carried column moved to the END (after Notes)** for every category, per Sophia — numbers less blurred together, notes more prominent. Grid is now Paid · Item · Budgeted · Actual · Notes · Variance.
- **Spelling: Roshack → Roshak** everywhere (labels, line names, notes, internal `property` key `roshack`→`roshak`). Migration `from < 14` rewrites stored data (all months incl. archived — cosmetic).
- **Name carry-over fixed.** Renaming a recurring line now updates its template entry so the new name prefills future months (`renameInTemplate`; seeds stamp `templateName` for stable matching). Migration `from < 14` also reconciles already-renamed lines by rebuilding the recurring template from the latest OPEN month (credit-card balances kept $0 in template). Amount auto-carry rule unchanged (only lines created in-month push amounts).
- **Removed leftover “Scope Test” junk line** (accidental test data from the build) from template + months. Made self-healing: `stripJunkBudgetLines()` runs on every load (after hydrate/migrate, regardless of schema) and strips name-matched junk (`/^(scope test|test line|test|zzz)\b/i`) from the template + every month, then persists — so it can't reappear via a once-only migration.

---

## Rental income relocation + meta-control gating (June 23, 2026, `wcib_dashboard_v12.html`, BUDGET_SCHEMA → 13)
Sophia: rental income isn't an expense with a Paid checkbox — it's money in, and belongs at the top.
- **Removed the "Other Income" expense category entirely.** Rental income is now a **manual top-of-page field** (`b.rentalIncome`) shown as a **"Blueberry income"** input box next to Gross income (editable on open months, read-only/locked on archived). `computeBudgetTotals` reads it as `otherIncome`; it feeds the Blueberry property income + net, the Operating View Blueberry book (synthesized "Blueberry Rent" income line), and `remaining = gross + rental − expenses`. CSV export gained a "Blueberry rental income" row.
- **Migration `from < 13`:** pulls any value off the old "Blueberry Rent" income line into `b.rentalIncome`, then deletes the income category from template + open months (archived untouched).
- **Does NOT carry over month-to-month** (per Sophia): each new month starts blank. When an open month's rental income is empty, the box shows a reminder state \u2014 a "\u26a0 add this month" chip, red-highlighted "Enter amount" field, and "don't forget this month's rent" note \u2014 which clear once a figure is entered.
- **Meta-control gating refined:** **Employees** no longer show "Charged to" (only Type + Property). **Hard Bills** show the **Property** dropdown only on the three mortgages (Roshack/Uplands/Blueberry) — removed from Taxes, WorldMark, Life Insurance, Mutual Funds, Health Insurance-Life Disability (none are property-tied).

---

## Business Payables tweaks (June 23, 2026, `wcib_dashboard_v12.html`, BUDGET_SCHEMA → 12)
Added **Payroll Taxes** to Business Payables (paychecks / payroll taxes; autopay; charged to Operating Biz account 9889) and removed the retired **Daphne Roth** line. Migration `from < 12` (template + open months; archived untouched).

---

## Categorization, property splits & collapsible budget (June 23, 2026, `wcib_dashboard_v12.html`, BUDGET_SCHEMA → 10 then 11)

Live refinements while Sophia tests:
- **Per-line controls are now relevance-gated** (not every box on every line): **Taxes** show neither auto-pay, charged-to, due, nor property (just Type). **Property** control shows only on **Employees, Income, and Hard Bills** (so the Blueberry mortgage can sit in the Blueberry book); hidden on payables, subscriptions, credit cards, taxes. Auto-pay/charged/due already gated off credit cards + employees earlier. *(Sophia’s longer-term ask: make which boxes appear fully per-line-customizable in the Settings build — noted, deferred to that section.)*
- **Tracy split** into two lines: base **Tracy** = personal home cleaning at Roshack (personal/roshack); **Tracy — Blueberry Cleaning** = $90/turnover clean of the rental (business/blueberry). **Hector split** likewise: **Hector** = Roshack landscape (personal/roshack); **Hector — Uplands Landscape** = office grounds (business/uplands). Tracy & Hector are the only employees that span properties.
- **Scope/property categorization** set so every line lands in the right Operating-View book: Roshack mortgage + WorldMark + Life Insurance + Mutual Funds + Health Insurance-Life Disability = **personal**; Uplands mortgage = **business**; Blueberry mortgage = **business + property=blueberry**; **Mercedes = business** (she’s an agency employee, was showing personal). Credit-card lines stay out of the books (payment vehicles).
- **Collapsible categories:** each category header collapses/expands (chevron + click; item count shown; state persisted in `wcib_v9_bdgcollapse`), plus a **Collapse all / Expand all** bar — so the growing budget isn’t one long scroll.
- **Migrations `from < 10` and `from < 11`** apply all the above to template + OPEN months; archived untouched.
- **STILL TO ENTER (flagged for Sophia):** personal subscriptions (ChatGPT personal, Renew Aesthetics, Sundance Marina, Daphne’s counseling, Massage Envy, Starbucks) and the per-property utilities (Roshack: PGE/Tualatin Valley Water/Waste Mgmt/NW Natural/sewer/Ziply; Uplands: Comcast/Tualatin Valley Water/Primo/Ziply/PGE/NW Natural/sewer; Blueberry: City of Sheridan water/Recology/PGE/Astound). And the **Settings section** to add cards/accounts + choose per-line boxes.

---

## Business/personal + property + income + Operating View (June 23, 2026, `wcib_dashboard_v12.html`, BUDGET_SCHEMA → 9)

Sophia wants to see expenses grouped for executive decisions — cost to run the company vs. personal, per-property cost, and rental income/net.
- **Two new per-line tags** (in each line’s controls): **Type** (Business / Personal) and **Property** (Roshack / Uplands / Blueberry / none). They sync to the recurring template like the other meta. Credit-card lines excluded from these rollups (a card is a payment vehicle, not an expense). Income lines only show the Property control.
- **New “Other Income (rental, etc.)” category** (seeded with a “Blueberry Rent” line tagged property=blueberry). Income lines are **excluded from expense totals** and instead add to income; `remaining = pay-sheet income + other income − expenses`.
- **Budget page bottom rollups:** “Operating costs & net” (Company/business cost · Personal · Income · Net all-in) and “By property” (cost, income, net per property).
- **New admin tab “Operating View”** (separate from the bill-paying Budget tab): regroups every line into three books — **Business (company & Uplands office)**, **Personal (incl. Roshack home)**, **Blueberry (rental)** — each with line detail (budgeted + actual), expense subtotal, income, and net; plus summary cards (business cost, personal cost, Blueberry net, total income, net all-in). Grouping rule: property=blueberry → Blueberry book; else personal-scope → Personal; else → Business.
- **Notes are now auto-growing textareas** (full note visible inline without scrolling; wrap fully in print/PDF). CSV export gained **Type** and **Property** columns.
- **Migration `from < 9`** (template + OPEN months; archived untouched): backfills `scope='business'`/`property=''` on every line and adds the Income category + Blueberry Rent line.
- **OPEN / still pending:** a Settings way to add a new credit card / bank account yourself (requested — currently cards live in the template + `PAY_ACCOUNTS` constant); and the per-property utility bills (City of Sheridan, Tualatin Valley Water ×2, Primo, PGE split, etc.) to be entered with real numbers.

---

## “Charged to” picker — bank/draft accounts added (June 23, 2026, `wcib_dashboard_v12.html`)

The “Charged to” dropdown now offers bank/draft accounts alongside the credit cards, split into two `<optgroup>`s (**Credit cards** / **Accounts**). Accounts seeded in the `PAY_ACCOUNTS` constant: **Operating Biz account 9889 · Personal Checking 9512 · Mutual Funds 0137 · Rent 1100**. The By-card rollup treats accounts as first-class sources (their own blocks, counted in the “no bills mapped yet” footer, never flagged as orphans). Empty option relabeled “— not assigned —.”

---

## Budget money formatting + per-category meta controls + DocuSign (June 23, 2026, `wcib_dashboard_v12.html`, BUDGET_SCHEMA → 7)

A run of focused refinements from Sophia testing live:
- **Editable Budgeted/Actual now format like the rest.** They were raw `<input type=number>` (e.g. `3200`) with a far-left floating `$`. Converted to `type=text` inputs that display `$3,200.00` (commas + `$` adjacent, right-aligned — matching the Variance/closed-cell `fmt()` style she wanted). On focus they strip to a clean editable number and select; on blur they re-format; `parseMoney()` tolerates `$`/commas on input. Helpers: `parseMoney` / `moneyFocus` / `moneyBlur`; `editBudgetLine` now parses via `parseMoney`.
- **Per-line meta controls are now category-aware** (the auto-pay toggle / “charged to” card / due-day box):
  - **Credit Cards:** no auto-pay (“I would never put a credit card on auto-pay”), no “charged to,” no due-day → no meta row at all.
  - **Employees:** no auto-pay, no due-day. “Charged to” is currently still shown — *open question for Sophia whether payroll lines should map to a card at all.*
  - All other categories keep all three.
- **DocuSign** added to Business Subscriptions: annual **$3,228**, renews **Jun 24**, autopay, card TBD. v12 has no annual mechanism yet, so it’s entered as a **monthly reserve of $269.00** ($3,228 ÷ 12) with the annual figure + renewal date in the note. (Proper annual handling is part of the queued restructure.)
- **Migration `from < 7`** (idempotent, template + OPEN months; archived untouched): adds DocuSign; forces `autopay=false`+`dueDay=''` on every Credit Card and Employee line (clears any test values).

---

## Start Fresh — clear test data (June 23, 2026, `wcib_dashboard_v12.html`)

Sophia entered hypothetical accounts + paid MGAs to bug-check, and wants to wipe that and restart with real data (repeatably, as she tests). Added an admin-only **“Start Fresh — clear test data”** panel at the bottom of **Manage Staff**, with a typed-confirm modal (`openResetModal` / `doStartFresh`).
- **Always clears (together, so nothing dangles):** the Policy Ledger, Approvals queue, saved drafts, and all Pay Sheets (KPI history rides on closed sheets, so it goes too). After clearing, `ensureSophiaSheetExists()` rebuilds Sophia’s empty current pay sheet so the page + budget-income binding stay valid.
- **Optional checkboxes:** reset Budget actuals to $0 (keeps bill lines + budgeted amounts); clear KPI goals/targets. Both default OFF.
- **Always kept:** staff & logins, MGA list, insurance companies, policy types, and (unless the budget box is ticked) the entire Budget.
- Modal shows live counts of what will be cleared; the destructive button stays disabled until the “I understand” box is checked. Re-renders the active page + all badges on completion. localStorage-scoped, no undo.

---

## Budget “excellence” deep-dive — auto-pay + card mapping (June 23, 2026, `wcib_dashboard_v12.html`, BUDGET_SCHEMA → 6)

Goal: a complete, go-live-ready record of every recurring bill so Sophia can test the month live. v11 copied to v12 before changes (v11 preserved untouched). Standalone-HTML / top-level-`let` / `test-harness.js` architecture unchanged.

### Schema → 6: three new fields on every budget line
`newBudgetLine` now carries, in addition to the existing fields:
- **`autopay`** (bool) — is this bill on auto-pay?
- **`chargedTo`** (string|null) — the **name** of the Credit Cards line this bill hits, or `null` if it isn't on a card. Stored by name (case-insensitive match), consistent with the existing name-keyed template model. If a card is renamed/removed, mapped bills surface as “orphans” in the By-card panel with a re-pick prompt rather than silently vanishing.
- **`dueDay`** (string) — free-text day-of-month the bill is due (kept as text so “1st”, “15”, “varies” all work).

These three are **structural metadata**: they sync to the recurring template for ANY recurring line via `syncMetaToTemplate` (called from `toggleBudgetAutopay` / `setBudgetCharged` / `setBudgetDue`), **independent of the per-month amount-edit rule** — i.e. setting “Amex, auto-pay, due 15” on a seeded recurring line in June carries to July and beyond, even though per-month *amount* edits still don’t change the standard. `syncLineToTemplate` also now writes these fields.

### Migration `migrateBudgets` → 6 (idempotent, `from < 6` block)
- Backfills `autopay=false`/`chargedTo=null`/`dueDay=''` on every line in the **template + OPEN months**.
- Adds the two missing recurring bills (below) to the template + open months if absent.
- **Archived months (May 2026) untouched**, per the standing rule. Fresh installs seed schema 6 directly (fields + the two new lines in the template constant).

### Missing bills added
- **Vistage** → Business Payables (executive peer-advisory membership). Seeded at **$0**, note flags that amount/due/card are pending Sophia’s input. *Placement is a best guess — confirm.*
- **Water Company** → Hard Bills (utility). Seeded at **$0**, note flags property/location + amount/due/card pending. *Placement + which property is a best guess — confirm.*
- More to be hunted category-by-category with Sophia (open).

### UI
- **Per-line meta row** under every budget line (open months: an Auto-pay checkbox, a “Charged to” card `<select>` populated from the month’s Credit Cards lines — hidden on CC lines themselves — and a Due-day input; closed months: compact read-only tags shown only when set).
- **“By card — what hits each card”** rollup panel below the categories: one card per block listing every non-CC bill charged to it, with an `auto` badge + due day, and a per-card subtotal (budget vs. charged). Cards with no mapped bills are listed in a muted footer; orphaned mappings get a red warning.
- **CSV export** gained `Auto-pay`, `Charged to card`, `Due day` columns for the accountant.

### CARRY-OVER items — status (still pending Sophia’s numbers; asked this thread)
- **Mortgages (Roshack/Uplands/Blueberry):** proposed rule reaffirmed — *Budgeted = base mortgage, Actual = what she actually pays (double), Variance = extra principal.* **Base amounts still `$____`** in the notes; awaiting her figures (the current Budgeted values 3200/4200/3800 are prior placeholders, not confirmed bases).
- **Hourly rates:** only Alicia’s $18.50/hr on file; others (Hector, Francisco, …) still pending — to drop into line notes when known.
- **Credit cards:** remain $0 in the template (intentional fresh start); Sophia enters real numbers as she tests. Unchanged.

---

## Budget fresh-start cleanup (June 23, 2026, `wcib_dashboard_v11.html`, BUDGET_SCHEMA → 5)

Sophia is going live and will test the budget this month from a clean slate. Questions form timed out; applied agreed-safe defaults and built note *structure* for the figures not yet provided.
- **All 11 credit cards zeroed.** Budgeted → $0 in the template (so every future month stays $0 until she enters real numbers) and in open months; carried-over due-amount/confirmation notes (Alaska, Amex, Sapphire, Cabela's) cleared for a clean slate. **May 2026 history is preserved** via a new `MAY_HISTORICAL_CC` constant used only by `seedBudgets` for the archived month — it still reconciles to the bills PDF ($60,590.27).
- **Mortgages (Roshack, Uplands, Blueberry under Hard Bills) flagged.** Each gets the note: *"Mortgage — base payment $____/mo. I make double payments; enter what I actually pay in the Actual column."* **Sophia still needs to fill in the base mortgage amount** for each. Recommended usage: keep **Budgeted = base mortgage**, record **Actual = what she actually pays** → Variance shows the extra principal automatically. The Blueberry *mortgage* is the Hard Bills line; the separate "Blueberry — TS Landscaping" line under Employees is untouched.
- **All Actuals + Paid flags reset to $0 / false in open months** for the clean test start (Budgeted left intact; auto-tax budgeted stays computed).
- **Kaylee's two rows confirmed as-is:** "Kaylee — Salary" ($13,000 draw) + "Kaylee — Commission" ($0; actual payout on the Pay Sheet). No change.
- **STILL PENDING from Sophia (not yet entered):** per-hour rates for hourly employees (only Alicia's $18.50/hr is on file, in her note), and the base mortgage amounts for the three properties. Drop these into the line notes when known.
- **Migration `migrateBudgets` → schema 5:** `from < 5` block applies the above to the template + OPEN months only; archived months left exactly as filed. Idempotent. Template source also updated so fresh installs seed the zeroed state directly.

## Production handoff (June 23, 2026)
Three advisory deliverables were generated alongside the prototype for the eventual backend port:
- **`WCIB_Data_Model.md`** — every entity/field/relationship pulled from the code; maps the 10 `wcib_v9_` localStorage keys to suggested Supabase tables; lists rules that must move from UI-only to server-enforced.
- **`WCIB_Permissions_Matrix.md`** — role × tab/action/field-level visibility; production enforcement checklist (auth, RLS, default-deny, immutability). Flags Earl's credit-card access as a scoped capability (NOT full admin) to be finalized when that build lands.
- **`Email_to_Ennis.md`** — draft email asking Ennis (Sophia's engineer friend) three things: can he do all four pieces (hosting/login+roles/database/real-time) to production; timeline (2 wks max, premium for 1 wk); his labor cost (Sophia covers all subscriptions/domain/hosting under her own accounts).
Guidance given: hire a coder for the secure foundation (auth/DB/permissions/deploy), let Earl+Claude maintain features on top; budget a pro **application-security / web-app-pentest** review (broken access control is the key risk; "employees never see financials" must be server-enforced, e.g. Supabase RLS). Running software cost est. $0–50/mo + ~$15/yr domain; foundation port est. low-to-mid four figures up to ~$10–20k DIY-with-Claude takes ~4–10 wks part-time.

---

## Phase 2C — Budget & Month History (June 22, 2026, `wcib_dashboard_v11.html`)

Built on top of v10. The standalone-HTML architecture, top-level-`let` state model, and `test-harness.js` reach-in pattern are all preserved (no conversion to a framework), so the harness keeps working.

### Refinements (same-day, post-initial-build)
- **Kaylee is two Employee lines:** "Kaylee — Salary" ($13k draw) and "Kaylee — Commission" (budget the monthly producer commission separately; actual payout still lives on the Pay Sheet).
- **Upcoming hires seeded at $0:** "Ellycia" and "Executive Assistant (TBD)" (rename when the name is known).
- **"Misc Monthly" → "Business Monthly Subscriptions",** and the recurring subscriptions moved into it from Business Payables: Agency Zoom, IT Company, PHMG Audio Company, RingCentral, Now Certs. Business Payables now holds Health Insurance, Taxes, Daphne Roth, Credit Card Fees, IRA.
- **Intertwined moved to the bottom** (kept, empty, for later).
- **Carry-over prompt on archive:** when a month is archived, any line that was *added that month* (not already recurring) triggers a per-line confirm — *"I see you added [Category] → [Name] for $X/month this month. Do you want this to carry over to future months?"* Yes → added to the recurring template and prefills future months; No → stays a one-month entry. Recurring lines always carry; per-month edits to a recurring line's amount do NOT change the standard.
- **Accountant export:** "Export to Excel" downloads a CSV (UTF-8 BOM so Excel opens it cleanly) of the displayed month — summary + every line with Budgeted/Actual/Variance/Paid/Notes and category totals. "Save PDF" prints just the Budget page via a `print-budget` body class.
- **Migration (`migrateBudgets`, schema → 4):** existing saved data is upgraded in place on load. Schema 2 split Kaylee + added hires; 3 moved subscriptions; 4 backfills the new per-line flags (`recurring`/`resolved`/`autoTax`/`templateName`) so old lines don't trip the add-time prompt. Migrations touch **only the template and OPEN months** — archived months (May 2026) are left exactly as filed. Idempotent, keyed off the stored `schema` field.

### Budget — second round of refinements
- **Recurring asked at ADD time, not on close.** When a newly-added line is first named (name field `onchange`), a confirm asks *"Add '[name]' to FUTURE budget months too? OK = recurring, Cancel = just [month]."* A round-arrow **↻ badge** on each editable row shows/toggles recurring state at any time. The old close-time prompt remains only as a safety net for lines left unresolved (`!l.resolved`).
- **Delete asks the same scope question.** Removing a line that's recurring/in-template prompts *"Remove '[name]' from FUTURE months too? OK = future as well, Cancel = this month only (returns next month)."* Non-template one-month lines delete silently.
- **Recurring standard syncs from the creating month.** Edits to a recurring line's budgeted/notes/name sync to the template only when `l.createdInKey === activeBudgetKey` (the month it was added) — preserving the earlier rule that per-month edits to *pre-existing* fixed lines don't change the standard.
- **Paid column moved to the FIRST column** (Paid · Item · Budgeted · Actual · Variance · Notes).
- **Hard Bills → Taxes is an auto tax-reserve = 30% of gross income.** Its Budgeted is computed (`applyAutoTax`, open months only) and shown read-only with an "auto 30%" badge; the Actual stays editable so Sophia records what she actually sets aside. Identified via `isAutoTaxLine` (catId 'hard' + name 'Taxes'); the Business Payables → Taxes ($3,640) line is a separate fixed payable and is untouched.
- **"Mark all paid" buttons:** one per category header (toggles to "Mark all unpaid" when all are paid) plus a global **"✓ Mark everything paid"** in the Budget actions bar.
- **Dollar signs on the editable Budgeted/Actual inputs** (`.bdg-money` wrapper with a `$` prefix); computed/closed cells already used `fmt()`.

### Pay Sheet — printing
- **"🖨 Full report — all agents"** button (top of Pay Sheet page) prints every agent's sheet, one agent per page (`.ps-pagebreak` → `break-before:page`).
- **"Print sheet"** button on each agent's header prints ONLY that agent's page — used to hand each producer their own sheet without exposing other agents' or Sophia's figures (a producer sheet only ever holds their own commission anyway; Sophia's block is simply excluded from an individual print).
- Implemented with a `print-paysheet` body class + per-block `.ps-print-hide` toggling in `_paySheetPrint(filterFn)`; closed-sheet panels auto-expand for print and the live view is restored via `renderPaySheets()` on `afterprint`. A `.ps-print-stamp` header (hidden on screen) labels each printed page.

### Pay-sheet KPIs & the annual "KPIs & Goals" tab
**Bug fix (settled policy re-appearing on a later open sheet):** a policy already locked into a CLOSED pay sheet was being re-added to the next month's OPEN sheet when its MGA-paid status was re-toggled (or it was edited) after the month closed — so June policies showed up on July's open sheet while still in closed June. Fix: `addPolicyToPaySheets` now skips adding to an open sheet if the policy is already on a CLOSED sheet for that owner (`policyOnClosedSheetFor`), and a one-time hydrate reconciliation strips any such duplicates off open sheets. A settled policy lives on exactly one sheet (the month it was paid) and only re-appears in history. Closed-sheet history is untouched.
- **Producer Pay Sheet rows** gained two columns: **Account** (Book vs 1st-yr house) and **Basis** (New vs Renewal), as colored pills. Sophia's sheet already showed Account type + Txn type.
- **Per-sheet breakdown** (below each producer sheet): four cards — New business, Renewal/existing, 1st-yr house, Their book — each with policy count, **$ paid to the producer**, and **$ agency revenue brought in**.
- **Classification (per Sophia's rules):** New = txn type `New` only; everything else (Renewal/Rewrite/Endorsement/Audit/Cross-sale) = Renewal/existing. "1st-yr house" = the `house` flag (paying a producer on a house account this year — the "free money" lens); "book" = their own renewing book.
- **New admin "KPIs" tab:** switchable **Company-wide ↔ each producer**, **year** picker + **Full year / Q1–Q4** period. Company view shows new-vs-renewal counts & revenue, retention rate, total agency revenue, and producer-payout split (total / 1st-yr house / book). Producer view shows what they brought in (new/renewal counts & revenue, retention) and what they were paid (total / house / book). Each has a **month-by-month trend** bar chart.
- **Targets vs. actual:** editable goal inputs on New-count, New-revenue, and Retention cards (per scope + year), stored in `kpiTargets` (key `wcib_v9_kpitargets`); a progress bar shows % of goal / "✓ goal met."
- **ℹ hover tooltips** on every column header, breakdown card, and KPI metric explaining what it is and how it's calculated.
- **Data source:** closing a Pay Sheet now writes a self-contained `policySnapshot` (per-policy txn type, account kind, revenue, payout) onto the sheet, so KPIs never depend on the live ledger and stay correct as months roll. Builds up as months are closed; shows a friendly empty state until then.

### Producer attribution generalized to ALL producers (was Kaylee-only)
The commission-attribution engine was hardcoded to Kaylee everywhere. It's now generalized so any producer with rates participates.
- **Data model:** a policy carries `producer` (the producer's name, '' = Sophia/house) alongside the existing `kaylee` split-flag (`'none'|'book'|'house'`). All 75/25 split math and the test harness are untouched — `kaylee!=='none'` still means "producer gets 25%."
- **Assignment is encoded** as `'none' | 'book:<Name>' | 'house:<Name>'` (`parseAssign`/`assignValueOf`/`assignLabel`). "Book" vs "1st-yr house" both pay the producer 25%; only the label differs.
- **Account Assignment (employee form)** lists Sophia + one button per producer, with a **gendered sub-label** ("Her/His/Their book of business"). `agentMode` = `'sophia'` or a producer name.
- **Commission assignment (admin form + approvals queue)** lists Sophia + **book and 1st-yr-house** per producer. The button group wraps so it scales to many producers.
- **Producers have a `gender`** field (Manage Staff: set on add, or change anytime via the Pronoun dropdown on the producer card). Drives the his/her/their labels. Kaylee→female, Joseph→male seeded.
- **Pay Sheets** route each attributed policy to the assigned producer's own sheet (not always Kaylee). Labels read "[Name]'s book" / "1st-yr house — [Name]".
- **Policy Ledger:** the old "Kaylee" column is now **"Account"** (shows "Sophia's account" / "[Name]'s book" / "1yr house — [Name]"); the metric card is **"Producer payouts MTD"**; and the **"Submitted by" chips are color-coded per person** (bold, distinct hues via `personColor`) for fast visual scanning.
- **Migration:** legacy attributed policies/queue entries (which had no `producer`) backfill to `'Kaylee'` on load, so existing data and pay sheets stay correct.

### Check Turn-In — Policy Type & Insurance Company are now searchable type-aheads
Both fields became MGA-style searchable type-aheads, reusing the existing `.mga-search-wrap`/`.mga-dropdown` styling.
- **Policy Type:** seeded with the full ~123-type list from Sophia's management system, each tagged with its **Class (LOB)** — Personal / Commercial / Life-Health — shown as a tag in the dropdown. Stored in `polTypeList` (key `wcib_v9_poltypes`). Adding a new type prompts for its class (P/C/L).
- **Insurance Company:** seeded with the full ~160-carrier list. Stored in `inscoList` (key `wcib_v9_insco`). Anyone can add a missing carrier from the dropdown (carriers aren't a financially-controlled vocab like MGAs, so no admin-only gate).
- **Value plumbing unchanged:** the selected value still lives in the hidden `#m-poltype` / `#m-insco` inputs, so every downstream read (`tx()`, `get()`, validation, submit, draft save/load) keeps working. A visible `#…-input` mirrors it; `syncPolTypeInput()` / `syncInscoInput()` realign on draft load, and `clearFormDOM()` resets both.

### Check Turn-In — validation banner moved to the bottom
The red "N issues to fix" banner used to render at the TOP of the form (first thing both employees and admins saw before entering anything). It now sits **directly above the Submit/Download actions** — so it only confronts the user at the end, after they've worked through the form. Pure DOM relocation; all IDs and `mCalc()` validation logic unchanged.

### New tabs: "Budget" and "History" (admin only)
Placed after Pay Sheet in the admin nav. Budget badge shows a red **"over"** flag when the current working month's Remaining is negative.

### Income = Sophia's matching Pay Sheet grand total, and it FREEZES on close
**Decision:** A budget month's Gross Income is pulled from the Sophia Pay Sheet for that **same month/year** (`ownerType==='sophia'`), read-only.
- While her sheet for that month is **open** → income shows live and is tagged **"provisional"**.
- The moment that sheet is **closed**, income **locks** to `sheet.totals.grandTotal` (agency gross brokerage revenue) and is tagged **"🔒 locked"**. Nothing entered afterward changes it.
- Future-month Pay Sheets feed future-month budgets only — closing/continuing July never touches June's number. This is enforced purely by the month/year key match, so there's no extra lock state to maintain.
**Why:** Matches Sophia's stated rule — "once I close the pay sheets, the budget income for that month stops changing; the next month's pay sheets don't roll into the current month."
**Historical months** (May 2026, which predates the Pay Sheet system) carry a frozen `manualIncome` figure instead of a live binding. When a month is archived, its live figure is also frozen into `manualIncome` so history is permanently stable.

### Budgeted vs. Actual, with variance
**Decision:** Every line has **Budgeted** (the planned/recurring amount) and **Actual** (what was paid), side by side, plus a color-coded **Variance** (green = under/on budget, red = over). Summary strip shows Gross Income · Total Expenses (with budgeted subtotal) · Remaining (red + parenthesized when negative) · Paid · Unpaid. Six **Category Totals** cards mirror Sophia's bills sheet.
**Seed (May 2026):** budgeted = actual = the figure from her May bills PDF (no separate budget existed before, so zero variance is honest). Reconciles exactly: Hard Bills $15,277.60 · Credit Cards $60,590.27 · Employees $39,980.00 · Business Payables $6,645.80 · Total $122,493.67 · Income $95,734.95 · Remaining ($26,758.72).

### Fixed lines carry over and stay editable
**Decision:** Categories + line items live in a recurring **template** that prefills each new month's **Budgeted** column (fixed amounts). Every value remains editable per-month — Sophia can change or zero any line for a given month without affecting the standard. Lines added/removed in a month update the template when the month is archived, so the structure keeps evolving. Actuals + Paid reset each new month.

### "Close the month" is now two separate, intentional actions
1. **Pay Sheets** close per-person (unchanged) — this is what locks budget income.
2. **Budget → Archive month** snapshots the month into Month History (read-only), freezes its income figure, and auto-opens the next month with fixed lines carried over. If Sophia's Pay Sheet for that month is still open, Archive warns that income is still provisional and suggests closing the Pay Sheet first.
The old `closeMonth()` shim now explains this split instead of pointing at "Phase 2C (to build)."

### Line items are the controlled vocabulary from the May 2026 bills PDF
Six categories: Hard Bills, Credit Cards, Employees, Intertwined, Business Payables, Misc Monthly. Notes from the PDF preserved (e.g. Alaska/Amex/Sapphire due-amount confirmations, Blueberry = TS Landscaping address, Alicia = new employee $18.50/hr). **Kaylee's $13,000 Employees line is the salary draw** — its note states the commission payout is tracked separately on the Pay Sheet (consistent with the standing "Kaylee appears twice" decision). **IT Company's $1,000** note states it's already inside CC totals (not double-counted).

### Storage
New key `wcib_v9_budgets` stores `{ budgets, template }`. Added to `persistAll()` and the hydrate IIFE; first run seeds May 2026 (archived) + June 2026 (working). `closePaySheet()` now refreshes the budget badge and re-renders the Budget page if it's open, so an income lock shows immediately.

### Still TODO for the backend port
- `budgets` is keyed by `${year}-${monthIndex}`; on Supabase this becomes a `budget_months` table with a unique (year, month) constraint and a FK to the Sophia pay sheet row for the live/locked income.
- The recurring `template` should become a server-side `budget_template` that's append-friendly (same spirit as append-only rate history).

---

## Phase 2D wrap-up — DOM safety fixes + test harness (June 4, 2026, `wcib_dashboard_v10.html`)

### The stale-empty-node bug class — found in ALL FOUR list renderers
**Date:** June 4, 2026
**The bug:** Several render functions captured their empty-state element with `getElementById`, then did `container.innerHTML = ''`, then (on the empty branch) `container.appendChild(empty)`. Because the empty-state `<div>` was a **child** of the container, `innerHTML=''` destroyed it. On the very next render where the list was empty, `getElementById` returned `null` and `appendChild(null)` **threw**, crashing the page (e.g. the Approvals tab would die the moment its queue went from having items back to empty — which happens on every normal send-back/approve).

**IMPORTANT correction to the prior handoff:** The v9 handoff claimed `renderApprovals` and `renderHelpRequests` were "fixed in v9." **They were not.** The test harness reproduced the crash in both. The earlier attempt left the buggy `appendChild` pattern in place. All four are now genuinely fixed and regression-tested.

**Functions fixed in v10 (all by the same pattern):**
1. `renderMGA` — `mga-empty` moved to a sibling of `mga-cards-wrap`; toggle `display` instead of appendChild.
2. `renderPaySheets` — removed the stray `wrap.appendChild(empty)` that moved `ps-empty-msg` into `ps-all-sheets` (it was already correctly a sibling in the HTML).
3. `renderApprovals` — `pending-empty` moved to a sibling of `pending-list`; toggle `display`.
4. `renderHelpRequests` — `help-empty` moved to a sibling of `help-list`; toggle `display`.

**The rule (apply to every future list renderer):** The empty-state element MUST be a **sibling** of the container that gets `innerHTML=''`, never a child. Show/hide it by toggling `style.display` — never `appendChild` it back, because once destroyed it can't be re-found.

### Test harness — `test-harness.js` (built and passing)
**Date:** June 4, 2026
**Setup:** Node.js LTS (v24.16.0) installed via winget; `npm install jsdom` (creates `node_modules/`, `package.json`, `package-lock.json` in the project folder).
**Run:** `node test-harness.js` from the project folder. Auto-loads the highest-numbered `wcib_dashboard_v*.html` (numeric sort — v10 beats "v9 (1)").
**Result on v10: 33 of 33 passing.** Covers all 10 mandatory Phase 2D cases (cross-user isolation, draft persistence, Clear button, 20-draft cap, help-request flow, send-back, logout hygiene, admin tab separation) + core business-logic calcs (T8) + the four-renderer DOM-safety regression tests (T9a–T9f).
**How the harness reaches app state:** the app's state is declared with top-level `let` (not `var`), so it is NOT on `window`. Functions ARE global. The harness reads/writes state via `window.eval('drafts')` etc. (top-level `let` lives in the shared global lexical environment, visible to indirect eval). Documented at the top of the harness file — keep this in mind if porting to a backend.
**Note for OneDrive:** `node_modules/` is ~thousands of files syncing to OneDrive. Consider adding a `.gitignore`/OneDrive exclusion, or run the harness from a local clone, if sync churn becomes annoying.

---

## Phase 2B — MGA Payables & Pay Sheets (May 30, 2026)

### Decision: Sophia's Pay Sheet shows FULL gross commission + broker fee — not her 75%
**Date:** May 30, 2026
**Context:** Open question from Phase 2A spec: for a Kaylee-assigned policy, do the Broker Fee and Commission columns show the full $ amounts as itemized on the policy, or Sophia's 75% share?
**Decision:** Show full amounts in the columns. The grand total at the bottom of Sophia's sheet = **agency gross brokerage revenue** for the period, not Sophia's take-home.
**Why:** Sophia's Pay Sheet is the agency's revenue document. Mixing full amounts and 75% amounts in the same column would be confusing for the print version Daphne Roth might see.
**Implementation:** A small footer row below the grand total shows "Sophia's actual take-home (100% of own + 75% of Kaylee-assigned)" with the calculated number, so her own share is never ambiguous.
**Implication for Phase 2C Budget:** When Budget pulls "gross income" from a closed Sophia Pay Sheet, it pulls the **grand total** (agency gross brokerage revenue) — that is the agency's actual top-line revenue for the month.

### Decision: On Pay Sheet close, auto-create next month's sheet for the same person
**Date:** May 30, 2026
**Decision:** When Sophia closes Kaylee's June 2026 Pay Sheet, July 2026 opens automatically for Kaylee. Same for Sophia's own sheet. Each person's months advance independently.
**Year roll:** Closing December auto-opens January of the following year.
**Why:** Avoids the "I forgot to open the new month" gap where MGA-paid policies would have nowhere to land.

### Decision: First-ever Pay Sheet defaults silently to June 2026
**Date:** May 30, 2026
**Decision:** The very first Pay Sheet the system creates uses June 2026 as the period name. No prompt, no modal.
**Why:** Avoids friction on first use. If Sophia wants a different starting period in production, that becomes a setting later.
**Implication for production:** When the prototype is ported to backend, the "starting period" should become a one-time admin setting on first deploy.

### Decision: MGA Payables is a continuous tracker — never month-bound
**Date:** May 30, 2026 (confirmation of Phase 2 spec intent)
**Decision:** A policy from March that's still unpaid in May continues to show on MGA Payables. No month carryforward concept — policies sit there until paid.
**Why:** Real MGA settlement happens on its own cadence, not aligned with Sophia's accounting close. Forcing a month boundary creates phantom "carryover" entries.

### Decision: Producer rate displayed live on open Pay Sheet
**Date:** May 30, 2026
**Decision:** Each open producer Pay Sheet shows the active rate at the top ("Using rates effective YYYY-MM-DD — New: X%/Y% · Renewal: X%/Y%"). Rates aren't snapshotted until close.
**Why:** Producers (and Sophia) need to see at a glance which rate the running totals reflect, so a mid-month rate change is visible before it locks at close.

### Decision: Sophia's Pay Sheet always exists from day one
**Date:** May 30, 2026
**Decision:** Sophia's June 2026 Pay Sheet is created the moment she logs into v8 — even before any policy is MGA-paid. Producer sheets only appear after their first MGA-paid policy.
**Why:** Sophia is always earning; producers are conditional. Showing her empty sheet on day one is the right default.

---

## Phase 2A — Producer Compensation (May 31, 2026)

### Decision: 2 rate pairs per producer, not 6
**Date:** May 31, 2026
**Context:** Phase 2 spec asked whether each producer needs separate rates per transaction type (New / Renewal / Rewrite / Endorsement / Audit / Cross-sale = 6 pairs) or a simpler New + Renewal model (2 pairs).
**Decision:** 2 pairs — New rates apply only to "New" transactions; Renewal rates apply to Renewal AND Rewrite/Endorsement/Audit/Cross-sale.
**Reasoning:** Simpler to maintain, matches how producer comp actually works in most agencies, cleaner data model for the eventual backend port. One-off rate differences can be handled per-policy via the existing override system (audit-trailed).
**Implication for future:** If a specific transaction type ever genuinely needs its own rate pair (e.g. "audits always pay differently"), we add a third pair then — cheaper to add than to remove.

### Decision: Rates are dated, looked up at sheet close
**Date:** May 31, 2026
**Decision:** When a rate changes, Sophia specifies an effective date. Pay Sheets look up the rate that was in effect on the date the Pay Sheet was CLOSED (not the policy approval date).
**Reasoning:** A rate change mid-month shouldn't retroactively alter what's already on an in-progress Pay Sheet. Closing the sheet "freezes" which rate applied.
**Implementation in v8:** When a producer Pay Sheet is closed, the full rate entry that was active that day is written to `paySheet.rateSnapshot`. Open Pay Sheets use today's rate.

### Decision: Producers cannot exist without rates
**Date:** May 31, 2026
**Decision:** The Add Staff form requires all 4 rate fields filled before save when role = producer.
**Reasoning:** A producer with missing rates would silently produce zero payouts and Sophia might miss it.
**Implementation in v8:** Closing a producer Pay Sheet also blocks with an alert if rates are missing.

### Decision: Rate history is never deleted (with one exception)
**Date:** May 31, 2026
**Decision:** Past rate entries cannot be deleted from a producer's history. Exception: if a producer has only one entry, deleting is blocked; if they have 2+, individual past entries can be deleted (with a "this cannot be undone" warning).
**Reasoning:** Past Pay Sheets snapshot the rate they used, so deleting an old rate entry doesn't break historical sheets — but the audit trail still has value.
**Reconsider when:** Backend port happens — at that point, rate history should be append-only on the server side.

### Decision: Build Phase 2 in two threads (2A and 2B)
**Date:** May 31, 2026
**Decision:** Phase 2A in this thread builds only producer compensation. Phase 2B in a fresh thread builds MGA Payables redesign + Pay Sheet redesign together.
**Reasoning:** Three interlocking redesigns in one thread risks rushed documentation and a long fragile test pass.

---

## Earlier decisions (pre-Phase-2A, recovered from spec docs)

### MGA list is a controlled vocabulary
Employees must select from the predefined MGA list — no free-text. Only Admin can add. Similarity check fires at 75% match to prevent near-duplicates. An MGA cannot be removed if it's used in the active month's ledger.

### Submitter tag is always visible
Every Check Turn-In and printed PDF shows who submitted it. Used for coaching, not just tracking.

### Employees never see financials
Net due to MGA, commission amounts, Kaylee splits, agency revenue — none visible to employees. Hard rule, enforced in UI.

### "Notify Sophia" button placement
Anchored both at top of error banner AND bottom of form — always reachable without scrolling.

### Month is a business concept, not a calendar concept
Sophia closes the month when she's ready. Unapproved entries roll forward automatically.

### Override always requires written reason
Original calculated values stored permanently in `overrideOriginal`. Override flag (purple dot) visible everywhere the policy appears — except producer Pay Sheets (Phase 2B decision).

### IT Company is NOT a separate budget line
$1,000/month paid via credit card — already inside CC totals.

### Kaylee appears twice in the budget
$13,000/month salary draw under Employees (cash reserve planning, not actual payroll) + commission payout from Pay Sheet. Clearly labeled, both count toward total expenses.

---

## Bug fixes baked into v8

### Submit button double-click guard
**Date:** May 30, 2026
**Problem:** Mercedes (and Sophia on admin add-direct) could double-tap the submit button and create two ledger entries for the same Check Turn-In.
**Fix:** The submit button now disables instantly on the first click, before any other code runs. It only re-enables after the form is cleared (which `submitTurnIn` does automatically on success) or after validation runs again on a new entry.
**Pattern to apply elsewhere:** Any button whose `onclick` creates a record should disable itself synchronously on the first line of its handler. Apply this defensively in all future builds.
