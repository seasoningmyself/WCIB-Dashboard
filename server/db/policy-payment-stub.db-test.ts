import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { readDatabaseErrorCode } from "./error-code.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "./policy-test-fixture.js";
import { policies } from "./schema.js";
import * as databaseSchema from "./schema.js";

async function expectDatabaseError(
  client: pg.PoolClient,
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  await client.query("SAVEPOINT expected_payment_stub_error");
  try {
    await assert.rejects(
      action,
      (error: unknown) => readDatabaseErrorCode(error) === code,
    );
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT expected_payment_stub_error");
    await client.query("RELEASE SAVEPOINT expected_payment_stub_error");
  }
}

test("payment stub persists true inputs and status-consistent defaults", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(
    databaseUrl,
    "DATABASE_URL is required for the policy payment stub smoke test",
  );

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const database = drizzle(client, { schema: databaseSchema });

  try {
    await client.query("BEGIN");
    const references = await createPolicyReferenceFixture(database);
    const [partial] = await database
      .insert(policies)
      .values(
        policyTestInput(references, {
          balanceDueDate: "2026-07-31",
          collectedToDate: "300.00",
          netDueTotal: "700.00",
          payableStatus: "partially_remitted",
          premiumTotal: "1000.00",
          receivableStatus: "partial",
          remittedToMga: "200.00",
        }),
      )
      .returning();
    assert.ok(partial);
    assert.equal(partial.premiumTotal, "1000.00");
    assert.equal(partial.collectedToDate, "300.00");
    assert.equal(partial.netDueTotal, "700.00");
    assert.equal(partial.remittedToMga, "200.00");
    assert.equal(partial.receivableStatus, "partial");
    assert.equal(partial.payableStatus, "partially_remitted");

    const [defaults] = await database
      .insert(policies)
      .values(
        policyTestInput(references, {
          insuredName: "Default Stub Insured",
          sourceDraftId: null,
        }),
      )
      .returning();
    assert.ok(defaults);
    assert.equal(defaults.premiumTotal, "0.00");
    assert.equal(defaults.collectedToDate, "0.00");
    assert.equal(defaults.receivableStatus, "paid");
    assert.equal(defaults.payableStatus, "paid");

    const forbiddenColumns = await database.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns
          where table_schema = 'public'
            and table_name = 'policies'
            and column_name in ('balance_due_from_insured', 'remaining_net_due')`,
    );
    assert.deepEqual(forbiddenColumns.rows, []);

    await expectDatabaseError(client, "23514", () =>
      database.insert(policies).values(
        policyTestInput(references, {
          collectedToDate: "300.00",
          premiumTotal: "1000.00",
          receivableStatus: "paid",
          sourceDraftId: null,
        }),
      ),
    );
    await expectDatabaseError(client, "23514", () =>
      database.insert(policies).values(
        policyTestInput(references, {
          collectedToDate: "1000.01",
          premiumTotal: "1000.00",
          receivableStatus: "partial",
          sourceDraftId: null,
        }),
      ),
    );
    await expectDatabaseError(client, "23514", () =>
      database.insert(policies).values(
        policyTestInput(references, {
          netDueTotal: "100.00",
          payableStatus: "partially_remitted",
          remittedToMga: "-0.01",
          sourceDraftId: null,
        }),
      ),
    );
    await expectDatabaseError(client, "22P02", () =>
      database.execute(sql`select 'unknown'::receivable_status`),
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
