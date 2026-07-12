import assert from "node:assert/strict";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { readDatabaseErrorCode } from "./error-code.js";
import { loadMigrationPlan } from "./migration-plan.js";
import { captureSchemaFingerprint } from "./migration-safety.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "./policy-test-fixture.js";
import { auditEvents, policies } from "./schema.js";
import * as databaseSchema from "./schema.js";

test("producer receipt timestamp is nullable, reversible, and guard-preserving", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for receipt storage test");

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const database = drizzle(client, { schema: databaseSchema });
  const migration = loadMigrationPlan().find(
    ({ tag }) => tag === "0037_producer_commission_received",
  );
  assert.ok(migration);

  try {
    await client.query("BEGIN");
    const column = await readReceiptColumn(client);
    assert.deepEqual(column, {
      column_default: null,
      data_type: "timestamp with time zone",
      is_nullable: "YES",
    });

    const references = await createPolicyReferenceFixture(database);
    const [policy] = await database
      .insert(policies)
      .values(
        policyTestInput(references, {
          insuredName: "Receipt Storage Verification",
          sourceDraftId: null,
        }),
      )
      .returning({
        id: policies.id,
        producerCommissionReceivedAt:
          policies.producerCommissionReceivedAt,
      });
    assert.ok(policy);
    assert.equal(policy.producerCommissionReceivedAt, null);

    const auditCountBefore = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(auditEvents);
    const receivedAt = new Date("2026-07-12T01:23:45.678Z");
    const [marked] = await database
      .update(policies)
      .set({ producerCommissionReceivedAt: receivedAt })
      .where(eq(policies.id, policy.id))
      .returning({ value: policies.producerCommissionReceivedAt });
    assert.equal(marked?.value?.toISOString(), receivedAt.toISOString());

    await client.query("SAVEPOINT receipt_backout_guard");
    try {
      await assert.rejects(
        client.query(migration.backoutStatements[0]!),
        (error: unknown) => readDatabaseErrorCode(error) === "55000",
      );
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT receipt_backout_guard");
      await client.query("RELEASE SAVEPOINT receipt_backout_guard");
    }

    const [cleared] = await database
      .update(policies)
      .set({ producerCommissionReceivedAt: null })
      .where(eq(policies.id, policy.id))
      .returning({ value: policies.producerCommissionReceivedAt });
    assert.equal(cleared?.value, null);
    const auditCountAfter = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(auditEvents);
    assert.deepEqual(auditCountAfter, auditCountBefore);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");

    const fingerprintBefore = await captureSchemaFingerprint(client);
    for (const statement of migration.backoutStatements) {
      await client.query(statement);
    }
    assert.equal(await readReceiptColumn(client), null);
    const backoutFingerprint = await captureSchemaFingerprint(client);
    assert.notEqual(backoutFingerprint, fingerprintBefore);

    for (const statement of migration.forwardStatements) {
      await client.query(statement);
    }
    assert.deepEqual(await readReceiptColumn(client), column);
    assert.notEqual(await captureSchemaFingerprint(client), backoutFingerprint);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
});

async function readReceiptColumn(client: pg.Client): Promise<{
  column_default: string | null;
  data_type: string;
  is_nullable: string;
} | null> {
  const result = await client.query<{
    column_default: string | null;
    data_type: string;
    is_nullable: string;
  }>(`
    SELECT column_default, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'policies'
      AND column_name = 'producer_commission_received_at'
  `);
  return result.rows[0] ?? null;
}
