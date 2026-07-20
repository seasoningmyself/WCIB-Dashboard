import assert from "node:assert/strict";
import { test } from "node:test";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { ActiveVocabularyResponse } from "../../../shared/vocabulary.js";
import { createEmptyTurnInState } from "./turn-in-state.js";
import { buildTurnInPrintModel } from "./turn-in-print.js";

const CARRIER_ID = "00000000-0000-4000-8000-000000000001";
const MGA_ID = "00000000-0000-4000-8000-000000000002";
const POLICY_TYPE_ID = "00000000-0000-4000-8000-000000000003";
const OFFICE_ID = "00000000-0000-4000-8000-000000000004";

test("turn-in print model uses clean entered-data sections and invoice wording", () => {
  const model = buildTurnInPrintModel({
    assignmentLabel: "Kaylee First-year",
    form: {
      ...createEmptyTurnInState(),
      accountAssignment: "house",
      amountPaid: "500.00",
      basePremium: "1000.00",
      brokerFee: "25.00",
      carrierId: CARRIER_ID,
      commissionMode: "pct",
      commissionRate: "10",
      depositOption: "400.00",
      effectiveDate: "07/17/2026",
      expirationDate: "07/17/2027",
      insuredName: "Acme LLC",
      invoiceNumber: "INV-17",
      mgaFee: "10.00",
      mgaId: MGA_ID,
      notes: "Print only entered content.",
      officeLocationId: OFFICE_ID,
      paymentMode: "direct",
      policyNumber: "POL-17",
      policyTypeId: POLICY_TYPE_ID,
      proposalTotal: "1135.00",
      taxes: "100.00",
      transactionNotes: "Added equipment",
      transactionType: "Endorsement",
    },
    printedAt: new Date("2026-07-17T15:30:00.000Z"),
    user: producer,
    vocabulary,
  });

  assert.equal(model.title, "Internal - New Check Turn-In");
  assert.equal(model.submitter, "Kaylee");
  assert.deepEqual(model.sections.map(({ title }) => title), [
    "Policy",
    "Premium detail",
    "Commission",
    "Payment",
    "Notes",
  ]);
  const rows = model.sections.flatMap(({ rows }) => rows);
  assert.deepEqual(find(rows, "Carrier"), { label: "Carrier", value: "Travelers" });
  assert.deepEqual(find(rows, "MGA"), { label: "MGA", value: "CNA" });
  assert.deepEqual(find(rows, "Account"), {
    label: "Account",
    value: "Kaylee First-year",
  });
  assert.deepEqual(find(rows, "WCIB Invoiced Total"), {
    label: "WCIB Invoiced Total",
    value: "$1,135.00",
  });
  assert.deepEqual(find(rows, "Deposit option (from carrier)"), {
    label: "Deposit option (from carrier)",
    value: "$400.00",
  });
  assert.equal(rows.some(({ label }) => label === "Financed balance"), false);
});

const producer: CurrentUser = {
  allowedNavigation: ["turn_in"],
  capabilities: [],
  displayName: "Kaylee",
  email: "kaylee@example.test",
  id: "00000000-0000-4000-8000-000000000010",
  passwordChangeRequired: false,
  role: "producer",
};

const vocabulary: ActiveVocabularyResponse = {
  carriers: [{ id: CARRIER_ID, name: "Travelers" }],
  mgas: [{ id: MGA_ID, name: "CNA" }],
  officeLocations: [{ id: OFFICE_ID, name: "San Francisco" }],
  officeMode: { activeCount: 1, kind: "single", soleOfficeId: OFFICE_ID },
  policyTypes: [{ classTag: "Commercial", id: POLICY_TYPE_ID, name: "General Liability" }],
};

function find(
  rows: readonly { label: string; value: string }[],
  label: string,
) {
  return rows.find((row) => row.label === label);
}
