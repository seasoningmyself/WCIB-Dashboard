import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDraftSubmissionSnapshot } from "./snapshot.js";

test("submitted snapshot parser accepts only the immutable lifecycle contract", () => {
  const parsed = parseDraftSubmissionSnapshot(validSnapshot());
  assert.equal(parsed.insuredName, "Snapshot Insured");
  assert.equal(parsed.commissionAmount, "125.00");

  for (const invalid of [
    { ...validSnapshot(), ownerUserId: "forged" },
    { ...validSnapshot(), commissionAmount: "125" },
    { ...validSnapshot(), carrierId: "not-a-uuid" },
    { schemaVersion: 1 },
  ]) {
    assert.throws(() => parseDraftSubmissionSnapshot(invalid));
  }
});

export function validSnapshot() {
  return {
    accountAssignment: "book" as const,
    amountPaid: "250.00",
    basePremium: "1000.00",
    brokerFee: "20.00",
    carrierId: "00000000-0000-4000-8000-000000000021",
    commissionAmount: "125.00",
    commissionConfirmed: true,
    commissionMode: "pct" as const,
    commissionRate: "12.5000",
    companyName: null,
    depositOption: "250.00",
    effectiveDate: "2026-07-11",
    expirationDate: "2027-07-11",
    financeBalance: "780.00",
    financeContact: null,
    financeMeta: null,
    financeReference: null,
    insuredName: "Snapshot Insured",
    invoiceNumber: null,
    ipfsFinanced: "no" as const,
    ipfsManual: false,
    ipfsReturning: null,
    kayleeSplit: "book" as const,
    mgaFee: "10.00",
    mgaId: "00000000-0000-4000-8000-000000000022",
    netDue: "105.00",
    notes: null,
    officeLocationId: "00000000-0000-4000-8000-000000000023",
    paymentMode: "deposit" as const,
    policyNumber: "SNAP-1",
    policyTypeId: "00000000-0000-4000-8000-000000000024",
    producerUserId: "00000000-0000-4000-8000-000000000025",
    proposalTotal: "1030.00",
    schemaVersion: 1,
    taxes: "0.00",
    transactionNotes: null,
    transactionType: "New",
  };
}
