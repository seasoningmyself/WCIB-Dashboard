import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approvedCoreSchemaFingerprint,
  coreSchemaTables,
  forbiddenCoreSchemaColumns,
  forbiddenCoreSchemaTables,
} from "./core-schema-contract.js";

test("approved Core Schema contract is explicit and excludes speculative scope", () => {
  assert.equal(coreSchemaTables.length, 22);
  assert.equal(new Set(coreSchemaTables).size, coreSchemaTables.length);
  assert.match(approvedCoreSchemaFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(forbiddenCoreSchemaTables, [
    "carrier_mga_defaults",
    "export_jobs",
    "migration_batches",
  ]);
  assert.deepEqual(forbiddenCoreSchemaColumns, [
    "balance_due_from_insured",
    "carrier_fee",
    "remaining_net_due",
  ]);
  assert.equal(coreSchemaTables.some((name) => /budget/i.test(name)), false);
});
