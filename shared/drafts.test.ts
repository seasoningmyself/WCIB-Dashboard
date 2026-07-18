import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDraftRequestSchema,
  draftWritableInputFromSource,
  flagDraftRequestSchema,
  listDraftsQuerySchema,
  submitDraftRequestSchema,
  updateDraftRequestSchema,
} from "./drafts.js";

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

test("submitted snapshots project back to only writable draft fields", () => {
  assert.deepEqual(
    draftWritableInputFromSource({
      accountAssignment: "book",
      basePremium: "1000",
      commissionAmount: "125.00",
      insuredName: "  Correctable LLC  ",
      netDue: "100.00",
      producerUserId: PRODUCER_ID,
      schemaVersion: 1,
      submittedByUserId: PRODUCER_ID,
    }),
    {
      accountAssignment: "book",
      basePremium: "1000.00",
      insuredName: "Correctable LLC",
      producerUserId: PRODUCER_ID,
    },
  );
});

test("draft help reasons are trimmed, bounded, and reason-only", () => {
  assert.deepEqual(flagDraftRequestSchema.parse({ reason: "  Need MGA help  " }), {
    reason: "Need MGA help",
  });
  for (const input of [
    {},
    { reason: "   " },
    { reason: "x".repeat(501) },
    { reason: "Help", ownerUserId: PRODUCER_ID },
  ]) {
    assert.equal(flagDraftRequestSchema.safeParse(input).success, false);
  }
});

test("draft submission accepts no client-authored policy payload", () => {
  assert.deepEqual(submitDraftRequestSchema.parse({}), {});
  for (const input of [
    { ownerUserId: PRODUCER_ID },
    { submittedAt: "2026-07-10T00:00:00.000Z" },
    { policy: {} },
    { basePremium: "1000.00" },
  ]) {
    assert.equal(submitDraftRequestSchema.safeParse(input).success, false);
  }
});

test("draft edits require at least one allowlisted content field", () => {
  assert.equal(updateDraftRequestSchema.safeParse({}).success, false);
  assert.deepEqual(updateDraftRequestSchema.parse({ insuredName: " Updated " }), {
    insuredName: "Updated",
  });
  for (const input of [
    { ownerUserId: PRODUCER_ID },
    { status: "draft" },
    { history: [] },
    { linkedQueueEntryId: PRODUCER_ID },
    { producerPayout: "100.00" },
  ]) {
    assert.equal(updateDraftRequestSchema.safeParse(input).success, false);
  }
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

test("own-draft filters accept only one supported status and no owner input", () => {
  assert.deepEqual(listDraftsQuerySchema.parse({}), {});
  assert.deepEqual(listDraftsQuerySchema.parse({ status: "flagged" }), {
    status: "flagged",
  });
  for (const query of [
    { status: "unknown" },
    { status: ["draft", "submitted"] },
    { ownerUserId: PRODUCER_ID },
  ]) {
    assert.equal(listDraftsQuerySchema.safeParse(query).success, false);
  }
});
