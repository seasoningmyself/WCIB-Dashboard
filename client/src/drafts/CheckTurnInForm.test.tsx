import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { DraftResponse } from "../../../shared/drafts.js";
import type { ActiveVocabularyResponse } from "../../../shared/vocabulary.js";
import { ApiClientProvider } from "../api/context.js";
import { createSessionBoundary } from "../auth/session-boundary.js";
import { VocabularyProvider } from "../vocabulary/context.js";
import {
  CheckTurnInFormView,
  type DraftHelpControl,
} from "./CheckTurnInForm.js";
import {
  buildAssignmentChoices,
  createEmptyTurnInState,
  type TurnInFormState,
} from "./turn-in-state.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";

test("Check Turn-In renders every active v15 input and exact producer assignment labels", () => {
  const user = producer();
  const form: TurnInFormState = {
    ...createEmptyTurnInState(),
    accountAssignment: "book",
    commissionMode: "pct",
    ipfsFinanced: "yes",
    ipfsReturning: "new",
    paymentMode: "deposit",
    producerUserId: USER_ID,
    transactionType: "Endorsement",
  };
  const markup = renderView({ form, user });

  for (const label of [
    "Assignment",
    "Office location",
    "Insured name",
    "Company name",
    "Policy type",
    "Transaction type",
    "Effective date",
    "Expiration date",
    "Invoice number",
    "Endorsement detail",
    "Insurance company",
    "MGA",
    "Policy number",
    "Base premium",
    "Taxes",
    "MGA fee",
    "Broker fee",
    "WCIB Invoiced Amount",
    "WCIB Invoiced Total",
    "Amount collected",
    "Net due to MGA",
    "Agency commission",
    "Carrier commission rate",
    "Agency commission total",
    "Payment mode",
    "Deposit option",
    "Finance balance",
    "Finance reference",
    "IPFS financing",
    "Handle IPFS manually",
    "IPFS insured",
    "Insured mobile",
    "Insured email",
    "Insured mailing address",
    "General notes",
  ]) {
    assert.match(markup, new RegExp(escapeRegExp(label)), label);
  }
  for (const assignment of ["First-year", "House account", "Kaylee account"]) {
    assert.match(markup, new RegExp(`>${escapeRegExp(assignment)}<`));
  }
  assertInOrder(markup, [
    "Account assignment",
    "Policy information",
    "WCIB invoiced amount — verify against the invoice",
    "Amount collected — from ePayPolicy receipt",
    "Carrier invoice — insurance company, MGA, policy # &amp; dates",
    "Commission",
    "Premium detail — from carrier invoice &amp; binding docs",
    "Payment type — confirm against ePayPolicy receipt",
    "Net due to MGA",
    "General notes",
  ]);
  assert.match(markup, /Submit for approval/);
  assert.match(markup, /Transaction type key/);
  for (const type of ["New", "Renewal", "Rewrite", "Won Back", "Cross-sale", "Endorsement", "Audit"]) {
    assert.match(markup, new RegExp(`>${escapeRegExp(type)}<`));
  }
  assert.match(markup, /aria-label="Add custom transaction type"/);
  assert.doesNotMatch(markup, /producer payout/i);
  assert.doesNotMatch(markup, /producer personal/i);
  assert.doesNotMatch(markup, /personal split/i);
  assert.doesNotMatch(markup, /producer rate/i);
  assert.doesNotMatch(markup, /localStorage/);
  assert.doesNotMatch(markup, /ownerUserId|linkedPolicyId|status selector/);
});

test("custom transaction values expose explicit add and remove controls", () => {
  const custom = renderView({
    form: { ...createEmptyTurnInState(), transactionType: "Reinstatement" },
    user: producer(),
  });
  const standard = renderView({
    form: { ...createEmptyTurnInState(), transactionType: "Renewal" },
    user: producer(),
  });

  assert.match(custom, /<option selected="">Reinstatement<\/option>/);
  assert.match(custom, /aria-label="Remove custom transaction type"/);
  assert.match(custom, /title="Remove this custom transaction type"/);
  assert.match(standard, /<option selected="">Renewal<\/option>/);
  assert.doesNotMatch(standard, /aria-label="Remove custom transaction type"/);
});

test("Deposit option is visible for every payment mode in v15 field order", () => {
  for (const paymentMode of ["full", "deposit", "direct"] as const) {
    const markup = renderView({
      form: { ...createEmptyTurnInState(), paymentMode },
      user: producer(),
    });

    assert.match(markup, /Deposit option from quote/);
    assert.ok(
      markup.indexOf("Deposit option from quote")
        < markup.indexOf("Amount collected — from ePayPolicy receipt"),
    );
  }
});

test("Audit and Endorsement use invoice wording while quote transactions revert", () => {
  for (const transactionType of ["Audit", "Endorsement"]) {
    const markup = renderView({
      form: { ...createEmptyTurnInState(), paymentMode: "deposit", transactionType },
      user: producer(),
    });
    assert.match(markup, /WCIB invoiced amount — verify against the invoice/);
    assert.match(markup, /WCIB Invoiced Amount — the total amount on the WCIB invoice/);
    assert.match(markup, /placeholder="Enter the WCIB invoiced amount"/);
    assert.match(markup, /Deposit option from carrier/);
    assert.match(markup, /Deposit option from the carrier — if a balance will be financed/);
    assert.match(markup, /WCIB Invoiced Total/);
    assert.doesNotMatch(markup, /Proposal total — verify against the quote/);
  }

  const renewal = renderView({
    form: { ...createEmptyTurnInState(), paymentMode: "deposit", transactionType: "Renewal" },
    user: producer(),
  });
  assert.match(renewal, /Proposal total — verify against the quote/);
  assert.match(renewal, /Proposal total from quote — confirm the premium on the proposal/);
  assert.match(renewal, /Deposit option from quote/);
  assert.match(renewal, /Proposal total \(incl\. broker fee\)/);
  assert.doesNotMatch(renewal, /WCIB Invoiced/);
});

test("turn-in dates accept typed text and numeric inputs expose wheel-safe controls", () => {
  const markup = renderView({
    form: {
      ...createEmptyTurnInState(),
      effectiveDate: "06/11/2026",
      expirationDate: "06/11/2027",
    },
    user: producer(),
  });

  assert.match(markup, /id="turn-in-effectiveDate"[^>]*inputMode="numeric"[^>]*placeholder="MM\/DD\/YYYY — type or say it"[^>]*type="text"[^>]*value="06\/11\/2026"/);
  assert.match(markup, /id="turn-in-expirationDate"[^>]*type="text"[^>]*value="06\/11\/2027"/);
  assert.match(markup, /id="turn-in-proposalTotal"[^>]*min="0"[^>]*step="0\.01"[^>]*type="number"/);
  assert.match(markup, /id="turn-in-commissionRate"[^>]*max="100"[^>]*min="0"[^>]*step="0\.01"[^>]*type="number"/);
});

test("submitted staff turn-ins immediately render no financial or IPFS controls", () => {
  const markup = renderView({
    draft: submittedDraft(),
    form: createEmptyTurnInState(),
    user: producer(),
  });

  assert.match(markup, /Turn-in submitted/);
  assert.match(markup, /approval queue/);
  for (const forbidden of [
    "Base premium",
    "Broker fee",
    "Agency commission total",
    "Amount collected",
    "IPFS financing",
    "Finance balance",
  ]) {
    assert.doesNotMatch(markup, new RegExp(escapeRegExp(forbidden)), forbidden);
  }
});

test("IPFS history shows prior context while preserving explicit selection controls", () => {
  const markup = renderView({
    form: {
      ...createEmptyTurnInState(),
      insuredName: "Acme LLC",
      ipfsFinanced: "yes",
      ipfsReturning: "new",
      paymentMode: "deposit",
    },
    ipfsHistory: {
      lastFinancedAt: "2026-06-01T12:00:00.000Z",
      status: "matched",
    },
    user: producer(),
  });
  assert.match(markup, /Prior IPFS financing found/);
  assert.match(markup, /last financed 06\/01\/2026/);
  assert.match(markup, /existing account and auto-pay setup/);
  assert.match(markup, /value="new"/);
  assert.match(markup, /value="returning"/);
});

test("validation state is accessible and admin submission targets the ledger", () => {
  const markup = renderView({
    errors: { insuredName: "Enter the insured name." },
    form: createEmptyTurnInState(),
    user: { ...producer(), capabilities: ["admin"], role: "admin" },
  });

  assert.match(markup, /aria-invalid="true"/);
  assert.match(markup, /aria-describedby="turn-in-insuredName-error"/);
  assert.match(markup, /1 issue to fix before submitting/);
  assert.match(markup, /title="Go to this field"/);
  assert.match(markup, /Fix →/);
  assert.match(markup, /Submit to ledger/);
});

test("payment guidance renders v15 full, direct-bill, and deposit context", () => {
  const base = {
    ...createEmptyTurnInState(),
    amountPaid: "1135.00",
    basePremium: "1000.00",
    brokerFee: "25.00",
    mgaFee: "10.00",
    taxes: "100.00",
  };
  const full = renderView({ form: { ...base, paymentMode: "full" }, user: producer() });
  const direct = renderView({ form: { ...base, amountPaid: "500.00", paymentMode: "direct" }, user: producer() });
  const deposit = renderView({ form: { ...base, amountPaid: "500.00", paymentMode: "deposit" }, user: producer() });

  assert.match(full, /✓ Matches full proposal total/);
  assert.match(direct, /carrier direct-bills the remaining \$635\.00 \(not financed by us\)/);
  assert.match(deposit, /Balance of \$635\.00 will be financed/);
});

test("pending writes disable the complete form and duplicate action buttons", () => {
  const markup = renderView({
    form: createEmptyTurnInState(),
    saveState: "saving",
    user: producer(),
  });
  assert.match(markup, /<fieldset[^>]*class="turn-in-controls"[^>]*disabled=""/);
  assert.match(markup, /<button[^>]*disabled=""[^>]*type="submit"/);
  assert.match(markup, /<button[^>]*disabled=""[^>]*type="button"/);
});

test("v15 header and footer expose complete status and duplicate action surfaces", () => {
  const markup = renderView({
    draft: draftWithStatus("draft"),
    form: { ...createEmptyTurnInState(), accountAssignment: "book", producerUserId: USER_ID },
    help: helpControl({ canRequest: true }),
    saveState: "saved",
    user: producer(),
  });

  for (const label of ["Date", "Submitter", "Account", "Status", "Saved"]) {
    assert.match(markup, new RegExp(`>${label}<`));
  }
  assert.match(markup, /Kaylee/);
  assert.match(markup, /Kaylee account/);
  assert.match(markup, />draft</);
  assert.match(markup, /Draft saved/);
  assert.match(markup, /Save &amp; start new/);
  assert.match(markup, /Clear form/);
  assert.match(markup, /Discard draft/);
  assert.match(markup, /Download PDF/);
  assert.match(markup, />Clear</);
  assert.equal((markup.match(/>Request help</g) ?? []).length, 2);
});

test("zero, one, and many office modes drive the turn-in controls", () => {
  const zero = renderView({
    form: createEmptyTurnInState(),
    user: producer(),
    vocabulary: vocabulary([]),
  });
  assert.match(zero, /Office setup required/);
  assert.match(zero, /No active office configured/);
  assert.match(zero, /Ask an administrator/);
  assert.doesNotMatch(zero, /Manage office locations/);
  assert.match(zero, /<fieldset[^>]*class="turn-in-controls"[^>]*disabled=""/);
  assert.match(zero, /<button[^>]*class="turn-in-save"[^>]*disabled=""/);
  assert.match(zero, /<button[^>]*class="turn-in-submit"[^>]*disabled=""/);

  const single = renderView({
    form: createEmptyTurnInState(),
    user: producer(),
    vocabulary: vocabulary([{ id: OFFICE_A, name: "San Francisco" }]),
  });
  assert.match(single, /San Francisco/);
  assert.doesNotMatch(single, /Office setup required|Select an active office location/);

  const multiple = renderView({
    form: createEmptyTurnInState(),
    user: producer(),
    vocabulary: vocabulary([
      { id: OFFICE_A, name: "San Francisco" },
      { id: OFFICE_B, name: "Oakland" },
    ]),
  });
  assert.match(multiple, /Select an active office location/);
  assert.match(multiple, /role="combobox"/);
  assert.match(multiple, /aria-required="true"/);
});

test("an admin receives a direct office-configuration action", () => {
  const markup = renderView({
    form: createEmptyTurnInState(),
    user: { ...producer(), capabilities: ["admin"], role: "admin" },
    vocabulary: vocabulary([]),
  });
  assert.match(markup, /href="#\/settings"/);
  assert.match(markup, /Manage office locations/);
  assert.doesNotMatch(markup, /Ask an administrator/);
});

test("eligible staff see Request Help only on their owned active draft", () => {
  const active = draftWithStatus("draft");
  const eligible = renderView({
    draft: active,
    form: createEmptyTurnInState(),
    help: helpControl({ canRequest: true }),
    user: producer(),
  });
  const admin = renderView({
    draft: active,
    form: createEmptyTurnInState(),
    help: helpControl({ canRequest: false }),
    user: { ...producer(), capabilities: ["admin"], role: "admin" },
  });

  assert.match(eligible, />Request help</);
  assert.doesNotMatch(admin, />Request help</);
});

test("help dialog is bounded, accessible, cancellable, and single-flight", () => {
  const markup = renderView({
    draft: draftWithStatus("draft"),
    form: createEmptyTurnInState(),
    help: helpControl({
      canRequest: true,
      error: "Explain what you need help with.",
      open: true,
      pending: true,
    }),
    user: producer(),
  });

  assert.match(markup, /role="dialog"/);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /maxLength="500"/);
  assert.match(markup, /aria-invalid="true"/);
  assert.match(markup, /Explain what you need help with/);
  assert.match(markup, /<button[^>]*disabled=""[^>]*>Cancel</);
  assert.match(markup, /Requesting\.\.\./);
});

test("flagged completion immediately renders no financial or IPFS controls", () => {
  const markup = renderView({
    draft: draftWithStatus("flagged", {
      basePremium: "1000.00",
      commissionRate: "10.0000",
      ipfsFinanced: "yes",
    }),
    form: { ...createEmptyTurnInState(), basePremium: "1000.00" },
    user: producer(),
  });

  assert.match(markup, /Help requested/);
  assert.match(markup, /admin Help Requests queue/);
  assert.doesNotMatch(markup, /Base premium|Agency commission total|IPFS financing/);
  assert.doesNotMatch(markup, /value="1000\.00"/);
});

function renderView({
  draft = null,
  errors = {},
  form,
  help,
  ipfsHistory,
  saveState = "idle",
  user,
  vocabulary,
}: {
  draft?: DraftResponse | null;
  errors?: Readonly<Record<string, string>>;
  form: TurnInFormState;
  help?: DraftHelpControl;
  ipfsHistory?: Parameters<typeof CheckTurnInFormView>[0]["ipfsHistory"];
  saveState?: "dirty" | "error" | "idle" | "saved" | "saving";
  user: CurrentUser;
  vocabulary?: ActiveVocabularyResponse;
}): string {
  const choices = buildAssignmentChoices(user, []);
  return renderToStaticMarkup(
    <ApiClientProvider
      boundary={createSessionBoundary(() => {})}
      client={{ async request() { return Response.json({}); } }}
    >
      <VocabularyProvider initialData={vocabulary}>
        <CheckTurnInFormView
          assignmentChoices={choices}
          assignmentState="ready"
          draft={draft}
          errors={errors}
          form={form}
          help={help}
          ipfsHistory={ipfsHistory}
          onAssignmentChange={() => {}}
          onClear={() => {}}
          onDiscard={() => {}}
          onFieldChange={() => {}}
          onPrint={() => {}}
          onRetryAssignments={() => {}}
          onSave={() => {}}
          onSaveAndStartNew={() => {}}
          onSubmit={() => {}}
          saveState={saveState}
          user={user}
        />
      </VocabularyProvider>
    </ApiClientProvider>,
  );
}

const OFFICE_A = "00000000-0000-4000-8000-000000000010";
const OFFICE_B = "00000000-0000-4000-8000-000000000011";

function vocabulary(
  officeLocations: ActiveVocabularyResponse["officeLocations"],
): ActiveVocabularyResponse {
  const activeCount = officeLocations.length;
  return {
    carriers: [],
    mgas: [],
    officeLocations,
    officeMode:
      activeCount === 0
        ? { activeCount: 0, kind: "unconfigured", soleOfficeId: null }
        : activeCount === 1
          ? { activeCount: 1, kind: "single", soleOfficeId: officeLocations[0]!.id }
          : { activeCount, kind: "multiple", soleOfficeId: null },
    policyTypes: [],
  };
}

function producer(): CurrentUser {
  return {
    allowedNavigation: ["turn_in", "my_items", "my_commissions"],
    capabilities: [],
    displayName: "Kaylee",
    email: "kaylee@example.test",
    id: USER_ID,
    role: "producer",
  };
}

function submittedDraft(): DraftResponse {
  return {
    accountAssignment: "book",
    carrierId: null,
    companyName: null,
    createdAt: "2026-07-10T12:00:00.000Z",
    effectiveDate: null,
    expirationDate: null,
    flagReason: null,
    history: [],
    id: "00000000-0000-4000-8000-000000000002",
    insuredName: "Acme LLC",
    invoiceNumber: null,
    lastEditedAt: "2026-07-10T12:00:00.000Z",
    linkedPolicyId: null,
    linkedQueueEntryId: "00000000-0000-4000-8000-000000000003",
    mgaId: null,
    notes: null,
    officeLocationId: null,
    ownerUserId: USER_ID,
    policyNumber: null,
    policyTypeId: null,
    producerUserId: USER_ID,
    schemaVersion: 1,
    sentBackAt: null,
    sentBackByUserId: null,
    sentBackReason: null,
    status: "submitted",
    submittedAt: "2026-07-10T12:05:00.000Z",
    transactionNotes: null,
    transactionType: "New",
  };
}

function draftWithStatus(
  status: DraftResponse["status"],
  overrides: Partial<DraftResponse> = {},
): DraftResponse {
  return {
    ...submittedDraft(),
    linkedQueueEntryId: null,
    status,
    submittedAt: status === "submitted" ? "2026-07-10T12:05:00.000Z" : null,
    ...overrides,
  };
}

function helpControl(
  overrides: Partial<DraftHelpControl> = {},
): DraftHelpControl {
  return {
    canRequest: false,
    error: null,
    onCancel() {},
    onOpen() {},
    onReasonChange() {},
    onSubmit() {},
    open: false,
    pending: false,
    reason: "",
    ...overrides,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertInOrder(markup: string, values: readonly string[]): void {
  let previousIndex = -1;
  for (const value of values) {
    const index = markup.indexOf(value);
    assert.notEqual(index, -1, `Expected markup to include ${value}`);
    assert.ok(index > previousIndex, `Expected ${value} to follow the prior field group`);
    previousIndex = index;
  }
}
