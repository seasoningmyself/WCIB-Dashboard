import assert from "node:assert/strict";
import { test } from "node:test";
import {
  myCommissionReceiptParamsSchema,
  myCommissionReceiptRequestSchema,
  myCommissionsListQuerySchema,
} from "./my-commissions.js";

test("My Commissions query has bounded search and no producer selector", () => {
  assert.deepEqual(myCommissionsListQuerySchema.parse({}), {
    search: "",
    sort: "insured",
  });
  assert.deepEqual(
    myCommissionsListQuerySchema.parse({ search: "  Acme  ", sort: "account" }),
    { search: "Acme", sort: "account" },
  );
  assert.throws(() =>
    myCommissionsListQuerySchema.parse({ producerUserId: crypto.randomUUID() }),
  );
  assert.throws(() =>
    myCommissionsListQuerySchema.parse({ search: "x".repeat(201) }),
  );
});

test("commission receipt requests accept only an opaque policy ID and state", () => {
  const policyId = crypto.randomUUID();
  assert.deepEqual(myCommissionReceiptParamsSchema.parse({ policyId }), {
    policyId,
  });
  assert.deepEqual(myCommissionReceiptRequestSchema.parse({ received: true }), {
    received: true,
  });
  for (const input of [
    {},
    { received: "true" },
    { actorUserId: crypto.randomUUID(), received: true },
    { received: true, receivedAt: new Date().toISOString() },
  ]) {
    assert.throws(() => myCommissionReceiptRequestSchema.parse(input));
  }
});
