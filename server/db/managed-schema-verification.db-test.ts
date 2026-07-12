import assert from "node:assert/strict";
import { test } from "node:test";
import { approvedCoreSchemaFingerprint } from "./core-schema-contract.js";
import { withDisposableMigratedDatabase } from "./disposable-database-test-helper.js";
import { verifyManagedSchema } from "./managed-schema-verification.js";

test("deployed Core Schema matches the approved blank PostgreSQL 18 contract", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for schema verification");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_managed_check",
    async (isolatedUrl) => {
      const result = await verifyManagedSchema(isolatedUrl);

      assert.equal(result.serverVersion.startsWith("18."), true);
      assert.equal(result.migrationCount, 39);
      assert.equal(result.tableCount, 22);
      assert.equal(result.totalRows, 0);
      assert.equal(result.fingerprint, approvedCoreSchemaFingerprint);
    },
  );
});
