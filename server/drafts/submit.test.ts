import assert from "node:assert/strict";
import { test } from "node:test";
import type { DraftRecord } from "../db/schema.js";
import {
  buildDraftSubmissionSnapshot,
  DraftSubmissionValidationError,
} from "./submit.js";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const POLICY_TYPE_ID = "00000000-0000-4000-8000-000000000002";
const CARRIER_ID = "00000000-0000-4000-8000-000000000003";
const MGA_ID = "00000000-0000-4000-8000-000000000004";
const OFFICE_ID = "00000000-0000-4000-8000-000000000005";

test("submission snapshot is server-owned and contains no producer payout fields", () => {
  const source = Object.assign(validDraft(), {
    applicableProducerRate: "25.0000",
    producerPayout: "37.50",
    producerRateHistory: [{ rate: "25.0000" }],
  });
  const snapshot = buildDraftSubmissionSnapshot(source);

  assert.equal(snapshot.commissionAmount, "100.00");
  assert.equal(snapshot.netDue, "350.00");
  assert.equal(snapshot.kayleeSplit, "none");
  assert.equal(snapshot.schemaVersion, 1);
  for (const field of [
    "applicableProducerRate",
    "producerPayout",
    "producerRate",
    "producerRateHistory",
  ]) {
    assert.equal(field in snapshot, false, field);
  }
});

test("submission validation reports incomplete v15 and IPFS requirements", () => {
  const source = validDraft({
    amountPaid: "0.00",
    brokerFee: null,
    carrierId: null,
    commissionConfirmed: false,
    effectiveDate: null,
    expirationDate: null,
    financeBalance: "780.00",
    financeContact: { address: "", email: "", mobile: "" },
    financeMeta: {
      billingType: "invoice",
      loanType: "commercial",
      minEarnedAmt: null,
      minEarnedPct: null,
    },
    insuredName: null,
    ipfsFinanced: "yes",
    ipfsReturning: null,
    paymentMode: "deposit",
    policyNumber: null,
    proposalTotal: "1080.00",
  });

  assert.throws(
    () => buildDraftSubmissionSnapshot(source),
    (error: unknown) => {
      assert.ok(error instanceof DraftSubmissionValidationError);
      const fields = error.details.map(({ field }) => field);
      for (const expected of [
        "insuredName",
        "policyNumber",
        "effectiveDate",
        "expirationDate",
        "carrierId",
        "brokerFee",
        "commissionConfirmed",
        "amountPaid",
        "proposalTotal",
        "ipfsReturning",
        "financeContact.mobile",
        "financeContact.email",
        "financeContact.address",
      ]) {
        assert.equal(fields.includes(expected), true, expected);
      }
      return true;
    },
  );
});

test("audit and endorsement submissions require an invoice number", () => {
  for (const transactionType of ["Audit", "Endorsement"]) {
    assert.throws(
      () =>
        buildDraftSubmissionSnapshot(
          validDraft({ invoiceNumber: null, transactionType }),
        ),
      (error: unknown) =>
        error instanceof DraftSubmissionValidationError &&
        error.details.some(({ field }) => field === "invoiceNumber"),
    );
  }
});

test("server submission validation uses the shared two-cent proposal tolerance", () => {
  for (const proposalTotal of [
    "1080.00",
    "1080.01",
    "1079.99",
    "1080.02",
    "1079.98",
  ]) {
    assert.doesNotThrow(
      () => buildDraftSubmissionSnapshot(validDraft({ proposalTotal })),
      proposalTotal,
    );
  }

  for (const proposalTotal of ["1080.03", "1079.97"]) {
    assert.throws(
      () => buildDraftSubmissionSnapshot(validDraft({ proposalTotal })),
      (error: unknown) =>
        error instanceof DraftSubmissionValidationError &&
        error.details.some(({ field }) => field === "proposalTotal"),
      proposalTotal,
    );
  }
});

function validDraft(input: Partial<DraftRecord> = {}): DraftRecord {
  return {
    accountAssignment: "none",
    amountPaid: "500.00",
    basePremium: "1000.00",
    brokerFee: "50.00",
    carrierId: CARRIER_ID,
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "10.0000",
    companyName: "Example LLC",
    createdAt: new Date("2026-07-10T00:00:00.000Z"),
    deleteReason: null,
    deletedAt: null,
    deletedByUserId: null,
    depositOption: "0.00",
    effectiveDate: "2026-07-10",
    expirationDate: "2027-07-10",
    financeBalance: "0.00",
    financeContact: null,
    financeMeta: null,
    financeReference: null,
    flagReason: null,
    history: [],
    id: "00000000-0000-4000-8000-000000000010",
    insuredName: "Submission Insured",
    invoiceNumber: null,
    ipfsFinanced: null,
    ipfsManual: false,
    ipfsPushed: false,
    ipfsPushedAt: null,
    ipfsReturning: null,
    lastEditedAt: new Date("2026-07-10T00:00:00.000Z"),
    linkedPolicyId: null,
    linkedQueueEntryId: null,
    mgaFee: "0.00",
    mgaId: MGA_ID,
    netDue: "350.00",
    notes: null,
    officeLocationId: OFFICE_ID,
    ownerUserId: OWNER_ID,
    paymentMode: "full",
    policyNumber: "SUBMIT-1",
    policyTypeId: POLICY_TYPE_ID,
    producerUserId: null,
    proposalTotal: "1080.00",
    schemaVersion: 1,
    sentBackAt: null,
    sentBackByUserId: null,
    sentBackReason: null,
    status: "draft",
    submittedAt: null,
    taxes: "30.00",
    transactionNotes: null,
    transactionType: "New",
    ...input,
  };
}
