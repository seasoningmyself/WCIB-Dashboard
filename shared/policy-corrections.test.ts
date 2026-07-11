import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_POLICY_CORRECTION_BYTES,
  MAX_POLICY_CORRECTION_REASON_LENGTH,
  POLICY_CORRECTION_FIELDS,
} from "./policy-corrections.js";

test("policy correction contract is an exact non-override allowlist", () => {
  assert.deepEqual(POLICY_CORRECTION_FIELDS, [
    "insuredName",
    "companyName",
    "policyNumber",
    "policyTypeId",
    "transactionType",
    "transactionNotes",
    "invoiceNumber",
    "effectiveDate",
    "expirationDate",
    "carrierId",
    "mgaId",
    "officeLocationId",
    "accountAssignment",
    "producerUserId",
    "kayleeSplit",
    "notes",
    "basePremium",
    "taxes",
    "mgaFee",
    "commissionRate",
    "commissionConfirmed",
    "amountPaid",
    "paymentMode",
    "depositOption",
    "financeReference",
    "ipfsFinanced",
    "ipfsManual",
    "ipfsReturning",
    "financeContact",
    "financeMeta",
  ]);
  assert.equal(
    new Set(POLICY_CORRECTION_FIELDS).size,
    POLICY_CORRECTION_FIELDS.length,
  );
  for (const forbidden of [
    "commissionAmount",
    "brokerFee",
    "netDue",
    "commissionMode",
    "proposalTotal",
    "financeBalance",
    "mgaPaid",
    "updatedAt",
  ]) {
    assert.equal(POLICY_CORRECTION_FIELDS.includes(forbidden as never), false);
  }
  assert.equal(MAX_POLICY_CORRECTION_BYTES, 16_384);
  assert.equal(MAX_POLICY_CORRECTION_REASON_LENGTH, 500);
});
