import assert from "node:assert/strict";
import { test } from "node:test";
import type { CurrentUser } from "../../../shared/current-user.js";
import {
  assignmentKey,
  buildAssignmentChoices,
  calculateTurnInSummary,
  createEmptyTurnInState,
  suggestAnnualExpiration,
  turnInFormToDraftInput,
  turnInFormToNonfinancialDraftUpdate,
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

test("turn-in validation enforces conditional invoice, commission, and IPFS fields", () => {
  const valid = completeState();
  assert.deepEqual(validateTurnInForSubmit(valid), {});

  const invalid = {
    ...valid,
    commissionConfirmed: false,
    expirationDate: "2025-07-10",
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

test("producer assignment labels map exactly onto v15 assignment values", () => {
  const producer = user("producer", "Kaylee");
  assert.deepEqual(buildAssignmentChoices(producer, []), [
    {
      accountAssignment: "none",
      key: assignmentKey("none", null),
      label: "House account",
      producerUserId: null,
    },
    {
      accountAssignment: "book",
      key: assignmentKey("book", USER_ID),
      label: "Kaylee account",
      producerUserId: USER_ID,
    },
    {
      accountAssignment: "house",
      key: assignmentKey("house", USER_ID),
      label: "First-year",
      producerUserId: USER_ID,
    },
  ]);

  assert.deepEqual(
    buildAssignmentChoices(user("employee", "Mercedes"), [
      { displayName: "Kaylee", userId: OTHER_ID },
    ]).map(({ label }) => label),
    ["House account", "Kaylee account", "Kaylee First-year"],
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

test("annual policy expiration suggestions are deterministic and scoped", () => {
  assert.equal(
    suggestAnnualExpiration("2026-07-10", "General Liability"),
    "2027-07-10",
  );
  assert.equal(
    suggestAnnualExpiration("2024-02-29", "Workers Compensation"),
    "2025-03-01",
  );
  assert.equal(suggestAnnualExpiration("2026-07-10", "Event Policy"), null);
  assert.equal(suggestAnnualExpiration("not-a-date", "Pollution"), null);
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
    effectiveDate: "2026-07-10",
    expirationDate: "2027-07-10",
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
    role,
  };
}
