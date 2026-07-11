import assert from "node:assert/strict";
import { test } from "node:test";
import { createDraftRequestSchema } from "./drafts.js";

const PRODUCER_ID = "00000000-0000-4000-8000-000000000001";

test("draft input normalizes exact decimal and text values", () => {
  assert.deepEqual(
    createDraftRequestSchema.parse({
      accountAssignment: "book",
      basePremium: "1000",
      commissionRate: "12.5",
      companyName: "  Example LLC  ",
      producerUserId: PRODUCER_ID,
    }),
    {
      accountAssignment: "book",
      basePremium: "1000.00",
      commissionRate: "12.5000",
      companyName: "Example LLC",
      producerUserId: PRODUCER_ID,
    },
  );
});

test("draft input rejects system fields, unsafe amounts, and broken assignments", () => {
  for (const input of [
    { ownerUserId: PRODUCER_ID },
    { status: "submitted" },
    { basePremium: -1 },
    { basePremium: "1.001" },
    { commissionRate: "100.0001" },
    { accountAssignment: "book", producerUserId: null },
    { accountAssignment: "none", producerUserId: PRODUCER_ID },
  ]) {
    assert.equal(createDraftRequestSchema.safeParse(input).success, false);
  }
});
