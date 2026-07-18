import assert from "node:assert/strict";
import { test } from "node:test";
import {
  POLICY_LEDGER_MAX_LIMIT,
  policyLedgerListQuerySchema,
} from "./policy-ledger.js";

test("policy ledger query accepts only bounded explicit controls", () => {
  assert.deepEqual(policyLedgerListQuerySchema.parse({}), {
    duplicates: "all",
    finance: "all",
    limit: 100,
    offset: 0,
    search: "",
    sort: "insured",
  });
  assert.deepEqual(
    policyLedgerListQuerySchema.parse({
      direction: "asc",
      duplicates: "only",
      finance: "ipfs_pending",
      limit: "25",
      month: "2026-07",
      offset: "50",
      search: "  Acme   Construction  ",
      sort: "insured",
    }),
    {
      direction: "asc",
      duplicates: "only",
      finance: "ipfs_pending",
      limit: 25,
      month: "2026-07",
      offset: 50,
      search: "Acme   Construction",
      sort: "insured",
    },
  );
});

test("policy ledger query rejects arbitrary fields and unbounded values", () => {
  for (const input of [
    { limit: POLICY_LEDGER_MAX_LIMIT + 1 },
    { month: "2026-13" },
    { offset: -1 },
    { ownerUserId: "00000000-0000-4000-8000-000000000001" },
    { sort: "basePremium" },
  ]) {
    assert.equal(policyLedgerListQuerySchema.safeParse(input).success, false);
  }
});
