import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_POLICY_CORRECTION_BYTES,
  MAX_POLICY_CORRECTION_REASON_LENGTH,
  policyLedgerCorrectionRequestSchema,
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

test("ledger correction requests keep general and override paths disjoint", () => {
  const expectedUpdatedAt = "2026-07-11T12:00:00.000Z";
  assert.deepEqual(
    policyLedgerCorrectionRequestSchema.parse({
      change: {
        changedFields: ["insuredName", "notes"],
        reason: "  Correct the bound record  ",
        replacementValues: {
          insuredName: "Corrected Insured",
          notes: null,
        },
      },
      expectedUpdatedAt,
      kind: "general",
    }),
    {
      change: {
        changedFields: ["insuredName", "notes"],
        reason: "Correct the bound record",
        replacementValues: {
          insuredName: "Corrected Insured",
          notes: null,
        },
      },
      expectedUpdatedAt,
      kind: "general",
    },
  );
  assert.equal(
    policyLedgerCorrectionRequestSchema.safeParse({
      change: {
        changedFields: ["brokerFee"],
        reason: "Wrong path",
        replacementValues: { brokerFee: "20.00" },
      },
      expectedUpdatedAt,
      kind: "general",
    }).success,
    false,
  );
  assert.equal(
    policyLedgerCorrectionRequestSchema.safeParse({
      change: {
        changedFields: ["insuredName"],
        reason: "Wrong path",
        replacementValues: { insuredName: "Wrong path" },
      },
      expectedUpdatedAt,
      kind: "override",
    }).success,
    false,
  );
});

test("ledger correction requests reject malformed, immutable, and mismatched values", () => {
  const expectedUpdatedAt = "2026-07-11T12:00:00.000Z";
  for (const change of [
    {
      changedFields: ["insuredName"],
      reason: "Required",
      replacementValues: {},
    },
    {
      changedFields: ["insuredName", "insuredName"],
      reason: "Required",
      replacementValues: { insuredName: "Corrected" },
    },
    {
      changedFields: ["basePremium"],
      reason: "Required",
      replacementValues: { basePremium: "1.2" },
    },
    {
      changedFields: ["insuredName"],
      reason: "   ",
      replacementValues: { insuredName: "Corrected" },
    },
    {
      changedFields: ["insuredName"],
      reason: "Required",
      replacementValues: {
        insuredName: "Corrected",
        mgaPaid: true,
      },
    },
  ]) {
    assert.equal(
      policyLedgerCorrectionRequestSchema.safeParse({
        change,
        expectedUpdatedAt,
        kind: "general",
      }).success,
      false,
    );
  }

  assert.equal(
    policyLedgerCorrectionRequestSchema.safeParse({
      change: {
        changedFields: ["brokerFee"],
        reason: "Required",
        replacementValues: { brokerFee: "20.0" },
      },
      expectedUpdatedAt,
      kind: "override",
    }).success,
    false,
  );
});
