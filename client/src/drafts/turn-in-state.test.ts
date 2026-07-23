import assert from "node:assert/strict";
import { test } from "node:test";
import type { CurrentUser } from "../../../shared/current-user.js";
import {
  applyIpfsReturningDetection,
  assignmentKey,
  BROKER_FEE_ONLY_CONFIRMATION,
  buildAssignmentChoices,
  calculateTurnInSummary,
  confirmBrokerFeeOnlySubmission,
  createEmptyTurnInState,
  getTurnInWording,
  getTurnInPaymentGuidance,
  isStandardTurnInTransactionType,
  normalizeTurnInDate,
  proposalTotalsMatch,
  requiresBrokerFeeOnlyConfirmation,
  suggestAnnualExpiration,
  turnInDateToIso,
  turnInFormHasContent,
  turnInFormToDraftInput,
  turnInFormToNonfinancialDraftUpdate,
  turnInStateFromSubmission,
  updateTurnInField,
  validateTurnInForSubmit,
  type TurnInFormState,
} from "./turn-in-state.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000002";
const OPTION_ID = "00000000-0000-4000-8000-000000000003";

test("turn-in state maps every active v15 input and excludes private producer split fields", () => {
  const state = completeState();
  const input = turnInFormToDraftInput(state);

  assert.deepEqual(input, {
    accountAssignment: "book",
    amountPaid: "500.00",
    basePremium: "1000.00",
    brokerFee: "25.00",
    carrierId: OPTION_ID,
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "10",
    companyName: "Acme Holdings",
    depositOption: "500.00",
    effectiveDate: "2026-07-10",
    expirationDate: "2027-07-10",
    financeContact: {
      address: "10 Main Street",
      email: "insured@example.test",
      mobile: "555-0100",
    },
    financeReference: "IPFS-22",
    insuredName: "Acme LLC",
    invoiceNumber: "INV-9",
    ipfsFinanced: "yes",
    ipfsManual: false,
    ipfsReturning: "new",
    mgaFee: "10.00",
    mgaId: OPTION_ID,
    notes: "General note",
    officeLocationId: OPTION_ID,
    paymentMode: "deposit",
    policyNumber: "POL-1",
    policyTypeId: OPTION_ID,
    producerUserId: USER_ID,
    proposalTotal: "1135.00",
    taxes: "100.00",
    transactionNotes: "Endorsement note",
    transactionType: "Endorsement",
  });
  for (const forbidden of [
    "producerPayout",
    "producerRate",
    "producerRateHistory",
    "personalSplit",
  ]) {
    assert.equal(forbidden in input, false, forbidden);
  }
});

test("blur autosave recognizes content without counting empty form defaults", () => {
  const empty = createEmptyTurnInState();
  assert.equal(turnInFormHasContent(empty), false);
  assert.equal(
    turnInFormHasContent({ ...empty, paymentMode: "direct" }),
    false,
    "default-only selections must preserve lazy draft creation",
  );
  assert.equal(
    turnInFormHasContent({ ...empty, insuredName: "Acme LLC" }),
    true,
  );
  assert.equal(
    turnInFormHasContent({ ...empty, depositOption: "250.00" }),
    true,
  );
});

test("immutable submission snapshots populate the full correction form", () => {
  const state = completeState();
  const restored = turnInStateFromSubmission({
    ...turnInFormToDraftInput(state),
    commissionAmount: "100.00",
    financeBalance: "635.00",
    kayleeSplit: "book",
    netDue: "375.00",
    schemaVersion: 1,
  });

  assert.equal(restored.insuredName, state.insuredName);
  assert.equal(restored.accountAssignment, "book");
  assert.equal(restored.producerUserId, USER_ID);
  assert.equal(restored.basePremium, "1000.00");
  assert.equal(restored.financeEmail, "insured@example.test");
  assert.equal(restored.effectiveDate, "07/10/2026");
});

test("turn-in validation enforces conditional invoice, commission, and IPFS fields", () => {
  const valid = completeState();
  assert.deepEqual(validateTurnInForSubmit(valid), {});

  const invalid = {
    ...valid,
    commissionConfirmed: false,
    expirationDate: "07/10/2025",
    financeAddress: "",
    financeEmail: "",
    financeMobile: "",
    invoiceNumber: "",
    ipfsReturning: "" as const,
    proposalTotal: "1100.00",
  };
  assert.deepEqual(validateTurnInForSubmit(invalid), {
    commissionConfirmed: "Confirm the agency commission against the carrier invoice.",
    expirationDate: "Expiration cannot precede the effective date.",
    financeAddress: "Enter the insured mailing address.",
    financeEmail: "Enter the insured email address.",
    financeMobile: "Enter the insured mobile number.",
    invoiceNumber: "Enter the invoice number for this transaction.",
    ipfsReturning: "Choose new or returning IPFS insured.",
    proposalTotal: "Proposal total must match premium, taxes, MGA fee, and broker fee.",
  });

  assert.deepEqual(
    validateTurnInForSubmit({ ...valid, ipfsManual: true }),
    {},
  );
});

test("broker-fee-only submissions require confirmation only without positive base premium", () => {
  assert.equal(requiresBrokerFeeOnlyConfirmation("1000.00"), false);
  assert.equal(requiresBrokerFeeOnlyConfirmation("0.00"), true);
  assert.equal(requiresBrokerFeeOnlyConfirmation(""), true);
  let message = "";
  assert.equal(
    confirmBrokerFeeOnlySubmission("0.00", (value) => {
      message = value;
      return false;
    }),
    false,
  );
  assert.equal(message, BROKER_FEE_ONLY_CONFIRMATION);
  assert.equal(
    confirmBrokerFeeOnlySubmission("1000.00", () => {
      throw new Error("positive premium must not ask for confirmation");
    }),
    true,
  );
});

test("agency totals are deterministic and are not a personal producer payout", () => {
  assert.deepEqual(calculateTurnInSummary(completeState()), {
    commissionAmount: "100.00",
    financeBalance: "635.00",
    netDue: "375.00",
    proposalTotal: "1135.00",
  });
});

test("sent-back reopen input contains only projected nonfinancial fields", () => {
  const input = turnInFormToNonfinancialDraftUpdate(completeState());

  assert.deepEqual(input, {
    accountAssignment: "book",
    carrierId: OPTION_ID,
    companyName: "Acme Holdings",
    effectiveDate: "2026-07-10",
    expirationDate: "2027-07-10",
    insuredName: "Acme LLC",
    invoiceNumber: "INV-9",
    mgaId: OPTION_ID,
    notes: "General note",
    officeLocationId: OPTION_ID,
    policyNumber: "POL-1",
    policyTypeId: OPTION_ID,
    producerUserId: USER_ID,
    transactionNotes: "Endorsement note",
    transactionType: "Endorsement",
  });
  for (const forbidden of [
    "amountPaid",
    "basePremium",
    "brokerFee",
    "commissionMode",
    "commissionRate",
    "depositOption",
    "financeContact",
    "financeReference",
    "ipfsFinanced",
    "ipfsManual",
    "ipfsReturning",
    "mgaFee",
    "paymentMode",
    "proposalTotal",
    "taxes",
  ]) {
    assert.equal(forbidden in input, false, forbidden);
  }
});

test("assignment choices match the v15 role boundaries", () => {
  const producer = user("producer", "Kaylee");
  assert.deepEqual(buildAssignmentChoices(producer, []), [
    {
      accountAssignment: "none",
      key: assignmentKey("none", null),
      label: "Sophia's account",
      producerUserId: null,
    },
    {
      accountAssignment: "book",
      key: assignmentKey("book", USER_ID),
      label: "Kaylee's account",
      producerUserId: USER_ID,
    },
    {
      accountAssignment: "house",
      key: assignmentKey("house", USER_ID),
      label: "1st-yr house - Kaylee",
      producerUserId: USER_ID,
    },
  ]);

  assert.deepEqual(
    buildAssignmentChoices(user("employee", "Mercedes"), [
      {
        bookEnabled: true,
        displayName: "Kaylee",
        firstYearEnabled: true,
        userId: OTHER_ID,
      },
    ]).map(({ label }) => label),
    ["Sophia's account", "Kaylee's account"],
  );

  assert.deepEqual(
    buildAssignmentChoices(user("admin", "Sophia"), [
      {
        bookEnabled: true,
        displayName: "Kaylee",
        firstYearEnabled: true,
        userId: OTHER_ID,
      },
    ]).map(({ label }) => label),
    ["Sophia's account", "Kaylee's account", "1st-yr house - Kaylee"],
  );
});

test("disabled producer assignment choices disappear without changing agency access", () => {
  const options = [
    {
      bookEnabled: false,
      displayName: "Kaylee",
      firstYearEnabled: true,
      userId: OTHER_ID,
    },
  ];
  assert.deepEqual(
    buildAssignmentChoices(user("admin", "Sophia"), options).map(
      ({ label }) => label,
    ),
    ["Sophia's account", "1st-yr house - Kaylee"],
  );
  assert.deepEqual(
    buildAssignmentChoices(user("employee", "Mercedes"), options).map(
      ({ label }) => label,
    ),
    ["Sophia's account"],
  );
});

test("v15 field transitions clear commission confirmation and default financed deposits", () => {
  const confirmed = { ...completeState(), commissionConfirmed: true };
  assert.equal(
    updateTurnInField(confirmed, "basePremium", "1200.00")
      .commissionConfirmed,
    false,
  );
  assert.equal(
    updateTurnInField(confirmed, "commissionRate", "12")
      .commissionConfirmed,
    false,
  );
  assert.equal(
    updateTurnInField(createEmptyTurnInState(), "paymentMode", "deposit")
      .ipfsFinanced,
    "yes",
  );
});

test("IPFS prior-financing detection defaults until a human overrides", () => {
  const state = { ...createEmptyTurnInState(), ipfsReturning: "" as const };
  assert.equal(
    applyIpfsReturningDetection(state, true, false).ipfsReturning,
    "returning",
  );
  assert.equal(
    applyIpfsReturningDetection(state, false, false).ipfsReturning,
    "new",
  );
  assert.equal(
    applyIpfsReturningDetection(
      { ...state, ipfsReturning: "new" },
      true,
      true,
    ).ipfsReturning,
    "new",
    "manual New selection must survive a later prior-history match",
  );
});

test("transaction values retain seven standards and bounded custom compatibility", () => {
  for (const standard of ["New", "Renewal", "Rewrite", "Won Back", "Cross-sale", "Endorsement", "Audit"]) {
    assert.equal(isStandardTurnInTransactionType(standard), true);
  }
  assert.equal(isStandardTurnInTransactionType("Reinstatement"), false);
  assert.equal(
    turnInFormToDraftInput({ ...createEmptyTurnInState(), transactionType: "Reinstatement" })
      .transactionType,
    "Reinstatement",
  );
});

test("v15 transaction wording is deterministic for invoice and notes contexts", () => {
  assert.deepEqual(getTurnInWording("Audit"), {
    calculatedTotalLabel: "WCIB Invoiced Total",
    depositHint: "Deposit option from the carrier — if a balance will be financed",
    depositLabel: "Deposit option from carrier",
    invoiceTransaction: true,
    notesLabel: "Audit detail",
    notesPlaceholder: "e.g. Sales increased from $50k to $200k — additional premium due",
    proposalInputLabel: "WCIB Invoiced Amount — the total amount on the WCIB invoice",
    proposalInputPlaceholder: "Enter the WCIB invoiced amount",
    proposalSectionTitle: "WCIB invoiced amount — verify against the invoice",
  });
  assert.equal(getTurnInWording("Endorsement").invoiceTransaction, true);
  assert.equal(getTurnInWording("Rewrite").notesLabel, "Rewrite detail");
  assert.equal(getTurnInWording("Renewal").notesLabel, "Renewal notes");
  assert.equal(getTurnInWording("New").notesLabel, "New policy notes");
  assert.equal(getTurnInWording("Cross-sale").notesLabel, "Cross-sale detail");
  assert.equal(getTurnInWording("Won Back").notesLabel, "Additional detail");
  assert.equal(getTurnInWording("Custom").notesPlaceholder, "Any relevant notes");
  assert.equal(getTurnInWording("Renewal").invoiceTransaction, false);
});

test("annual policy expiration suggestions are deterministic and scoped", () => {
  assert.equal(
    suggestAnnualExpiration("07/10/2026", "General Liability"),
    "07/10/2027",
  );
  assert.equal(
    suggestAnnualExpiration("02/29/2024", "Workers Compensation"),
    "03/01/2025",
  );
  assert.equal(suggestAnnualExpiration("07/10/2026", "Event Policy"), null);
  assert.equal(suggestAnnualExpiration("not-a-date", "Pollution"), null);
});

test("typed and spoken turn-in dates normalize like v15 and serialize as ISO", () => {
  assert.equal(normalizeTurnInDate("06112026"), "06/11/2026");
  assert.equal(normalizeTurnInDate("6102026"), "06/10/2026");
  assert.equal(normalizeTurnInDate("061026"), "06/10/2026");
  assert.equal(normalizeTurnInDate("61026"), "06/10/2026");
  assert.equal(normalizeTurnInDate("6926"), "06/09/2026");
  assert.equal(normalizeTurnInDate("6-11-26"), "06/11/2026");
  assert.equal(normalizeTurnInDate("6 2026"), "06/01/2026");
  assert.equal(normalizeTurnInDate("2026-06-11"), "06/11/2026");
  assert.equal(normalizeTurnInDate("June 5 2026"), "06/05/2026");
  assert.equal(normalizeTurnInDate("not a date"), "not a date");
  assert.equal(turnInDateToIso("06/11/2026"), "2026-06-11");
  assert.equal(turnInDateToIso("02/31/2026"), null);
  assert.equal(
    turnInFormToDraftInput({
      ...createEmptyTurnInState(),
      effectiveDate: "06/11/2026",
      expirationDate: "06/11/2027",
    }).effectiveDate,
    "2026-06-11",
  );
});

test("proposal validation accepts v15's two-cent tolerance and rejects three cents", () => {
  const valid = completeState();
  assert.equal(proposalTotalsMatch("1135.02", "1135.00"), true);
  assert.equal(proposalTotalsMatch("1134.98", "1135.00"), true);
  assert.equal(proposalTotalsMatch("1135.03", "1135.00"), false);
  assert.equal(validateTurnInForSubmit({ ...valid, proposalTotal: "1135.02" }).proposalTotal, undefined);
  assert.equal(
    validateTurnInForSubmit({ ...valid, proposalTotal: "1135.03" }).proposalTotal,
    "Proposal total must match premium, taxes, MGA fee, and broker fee.",
  );
});

test("payment guidance matches v15 for full, direct-bill, and financed deposits", () => {
  const state = completeState();
  assert.deepEqual(
    getTurnInPaymentGuidance({ ...state, amountPaid: "1135.01", paymentMode: "full" }),
    { text: "Matches full proposal total", tone: "good" },
  );
  assert.deepEqual(
    getTurnInPaymentGuidance({ ...state, amountPaid: "500.00", paymentMode: "full" }),
    { text: "Full proposal total is $1,135.00 — confirm this is correct", tone: "error" },
  );
  assert.deepEqual(
    getTurnInPaymentGuidance({ ...state, amountPaid: "500.00", paymentMode: "direct" }),
    {
      text: "Deposit collected · carrier direct-bills the remaining $635.00 (not financed by us)",
      tone: "neutral",
    },
  );
  assert.deepEqual(
    getTurnInPaymentGuidance({ ...state, amountPaid: "500.00", paymentMode: "deposit" }),
    { text: "Deposit · Balance of $635.00 will be financed", tone: "neutral" },
  );
});

function completeState(): TurnInFormState {
  return {
    ...createEmptyTurnInState(),
    accountAssignment: "book",
    amountPaid: "500.00",
    basePremium: "1000.00",
    brokerFee: "25.00",
    carrierId: OPTION_ID,
    commissionConfirmed: true,
    commissionRate: "10",
    companyName: "Acme Holdings",
    depositOption: "500.00",
    effectiveDate: "07/10/2026",
    expirationDate: "07/10/2027",
    financeAddress: "10 Main Street",
    financeEmail: "insured@example.test",
    financeMobile: "555-0100",
    financeReference: "IPFS-22",
    insuredName: "Acme LLC",
    invoiceNumber: "INV-9",
    ipfsFinanced: "yes",
    ipfsReturning: "new",
    mgaFee: "10.00",
    mgaId: OPTION_ID,
    notes: "General note",
    officeLocationId: OPTION_ID,
    paymentMode: "deposit",
    policyNumber: "POL-1",
    policyTypeId: OPTION_ID,
    producerUserId: USER_ID,
    proposalTotal: "1135.00",
    taxes: "100.00",
    transactionNotes: "Endorsement note",
    transactionType: "Endorsement",
  };
}

function user(role: CurrentUser["role"], displayName: string): CurrentUser {
  return {
    allowedNavigation: ["turn_in", "my_items"],
    capabilities: [],
    displayName,
    email: `${displayName.toLowerCase()}@example.test`,
    id: USER_ID,
    passwordChangeRequired: false,
    role,
  };
}
