import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { readDatabaseErrorCode } from "./error-code.js";
import { policies, type NewPolicyRecord } from "./schema.js";
import * as databaseSchema from "./schema.js";

function policyInput(
  input: Partial<NewPolicyRecord> = {},
): NewPolicyRecord {
  const timestamp = new Date("2026-07-01T12:00:00.000Z");
  return {
    accountAssignment: "none",
    amountPaid: "0.00",
    approvedAt: timestamp,
    basePremium: "0.00",
    brokerFee: "0.00",
    carrierId: randomUUID(),
    commissionAmount: "0.00",
    commissionConfirmed: false,
    commissionMode: "na",
    effectiveDate: "2026-07-01",
    expirationDate: "2027-07-01",
    financeBalance: "0.00",
    insuredName: "Payment Stub Insured",
    kayleeSplit: "none",
    mgaId: randomUUID(),
    netDue: "0.00",
    officeLocationId: randomUUID(),
    paymentMode: "full",
    policyNumber: `PAYMENT-${randomUUID()}`,
    policyTypeId: randomUUID(),
    proposalTotal: "0.00",
    submittedAt: timestamp,
    submittedByUserId: randomUUID(),
    transactionType: "New",
    ...input,
  };
}

test("payment stub persists true inputs and status-consistent defaults", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(
    databaseUrl,
    "DATABASE_URL is required for the policy payment stub smoke test",
  );

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const database = drizzle(pool, { schema: databaseSchema });
  const policyIds: string[] = [];

  try {
    const [partial] = await database
      .insert(policies)
      .values(
        policyInput({
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
    policyIds.push(partial.id);
    assert.equal(partial.premiumTotal, "1000.00");
    assert.equal(partial.collectedToDate, "300.00");
    assert.equal(partial.netDueTotal, "700.00");
    assert.equal(partial.remittedToMga, "200.00");
    assert.equal(partial.receivableStatus, "partial");
    assert.equal(partial.payableStatus, "partially_remitted");

    const [defaults] = await database
      .insert(policies)
      .values(policyInput({ insuredName: "Default Stub Insured" }))
      .returning();
    assert.ok(defaults);
    policyIds.push(defaults.id);
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

    await assert.rejects(
      database.insert(policies).values(
        policyInput({
          collectedToDate: "300.00",
          premiumTotal: "1000.00",
          receivableStatus: "paid",
        }),
      ),
      (error: unknown) => readDatabaseErrorCode(error) === "23514",
    );
    await assert.rejects(
      database.insert(policies).values(
        policyInput({
          collectedToDate: "1000.01",
          premiumTotal: "1000.00",
          receivableStatus: "partial",
        }),
      ),
      (error: unknown) => readDatabaseErrorCode(error) === "23514",
    );
    await assert.rejects(
      database.insert(policies).values(
        policyInput({
          netDueTotal: "100.00",
          payableStatus: "partially_remitted",
          remittedToMga: "-0.01",
        }),
      ),
      (error: unknown) => readDatabaseErrorCode(error) === "23514",
    );
    await assert.rejects(
      database.execute(sql`select 'unknown'::receivable_status`),
      (error: unknown) => readDatabaseErrorCode(error) === "22P02",
    );
  } finally {
    if (policyIds.length > 0) {
      await database.delete(policies).where(inArray(policies.id, policyIds));
    }
    await pool.end();
  }
});
