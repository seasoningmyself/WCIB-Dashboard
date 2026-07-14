import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { approvedCoreSchemaFingerprint } from "./core-schema-contract.js";
import { withDisposableDatabase } from "./disposable-database-test-helper.js";
import { applyMigrations, migrationAdvisoryLockKey } from "./migrate.js";
import {
  captureSchemaFingerprint,
  failureInjectionTags,
  verifyMigrationSafety,
} from "./migration-safety.js";

test("all migrations survive forward, rollback, reapply, and injected failures", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for migration safety testing");

  const result = await verifyMigrationSafety(databaseUrl);

  assert.equal(result.migrationCount, 43);
  assert.deepEqual(result.failureInjectionTags, failureInjectionTags);
  assert.equal(result.finalFingerprint, approvedCoreSchemaFingerprint);
  assert.deepEqual(
    result.phases.map((phase) => phase.name),
    [
      "forward",
      "rollback",
      "reapply",
      ...failureInjectionTags.map((tag) => `failure-injection:${tag}`),
    ],
  );
  assert.ok(result.phases.every((phase) => phase.status === "passed"));
  assert.ok(result.phases.every((phase) => phase.durationMs >= 0));
});

test("schema fingerprints detect logical columns and ignore dropped-column tombstones", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for fingerprint testing");

  await withDisposableDatabase(
    databaseUrl,
    "wcib_fingerprint",
    async (isolatedUrl) => {
      await applyMigrations(isolatedUrl);
      const client = new pg.Client({ connectionString: isolatedUrl });
      await client.connect();
      try {
        const baselineFingerprint = await captureSchemaFingerprint(client);
        await client.query(
          'ALTER TABLE "pay_sheet_adjustments" ADD COLUMN "fingerprint_probe" text',
        );
        const changedFingerprint = await captureSchemaFingerprint(client);
        assert.notEqual(changedFingerprint, baselineFingerprint);

        await client.query(
          'ALTER TABLE "pay_sheet_adjustments" DROP COLUMN "fingerprint_probe"',
        );
        assert.equal(
          await captureSchemaFingerprint(client),
          baselineFingerprint,
        );
      } finally {
        await client.end();
      }
    },
  );
});

test("a second migration process fails closed while the advisory lock is held", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for migration lock testing");

  await withDisposableDatabase(databaseUrl, "wcib_lock", async (isolatedUrl) => {
    const lockHolder = new pg.Client({ connectionString: isolatedUrl });
    await lockHolder.connect();
    try {
      await lockHolder.query("SELECT pg_advisory_lock($1)", [
        migrationAdvisoryLockKey,
      ]);
      await assert.rejects(
        applyMigrations(isolatedUrl),
        /Another migration process holds the database lock/,
      );
    } finally {
      await lockHolder.query("SELECT pg_advisory_unlock($1)", [
        migrationAdvisoryLockKey,
      ]);
      await lockHolder.end();
    }
  });
});
