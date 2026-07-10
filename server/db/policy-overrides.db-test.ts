import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createUser } from "../auth/users.js";
import { buildPolicyOverrideValuePair } from "../policies/override-values.js";
import { readDatabaseErrorCode } from "./error-code.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "./policy-test-fixture.js";
import { policies, policyOverrides, users } from "./schema.js";
import * as databaseSchema from "./schema.js";

let savepointSequence = 0;

async function expectDatabaseError(
  client: pg.PoolClient,
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  const savepoint = `expected_override_error_${savepointSequence++}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await assert.rejects(
      action,
      (error: unknown) => readDatabaseErrorCode(error) === code,
    );
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  }
}

test("policy overrides persist only bounded UUID-linked financial changes", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for override DB test");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const database = drizzle(client, { schema: databaseSchema });

  try {
    await client.query("BEGIN");
    const references = await createPolicyReferenceFixture(database);
    const approver = await createUser(database, {
      email: `override-approver-${randomUUID()}@example.test`,
      password: "StrongPass123!",
    });
    const [policy] = await database
      .insert(policies)
      .values(
        policyTestInput(references, {
          policyNumber: "OVERRIDE-SOURCE",
          sourceDraftId: null,
        }),
      )
      .returning();
    assert.ok(policy);

    const values = buildPolicyOverrideValuePair(
      { brokerFee: "0.00", commissionAmount: "0.00" },
      { brokerFee: "25.00", commissionAmount: "100.00" },
      ["brokerFee", "commissionAmount"],
    );
    const [override] = await database
      .insert(policyOverrides)
      .values({
        approvedByUserId: approver.id,
        originalValues: values.originalValues,
        policyId: policy.id,
        reason: "Correct carrier statement figures",
        replacementValues: values.replacementValues,
      })
      .returning();
    assert.ok(override);
    assert.equal(override.policyId, policy.id);
    assert.equal(override.approvedByUserId, approver.id);
    assert.deepEqual(override.originalValues, {
      brokerFee: "0.00",
      commissionAmount: "0.00",
    });

    for (const invalidValues of [
      [],
      {},
      { insuredName: "Private insured" },
      { brokerFee: 25 },
      { brokerFee: "1".repeat(5_000) },
    ]) {
      await expectDatabaseError(client, "23514", () =>
        database.insert(policyOverrides).values({
          approvedByUserId: approver.id,
          originalValues: invalidValues,
          policyId: policy.id,
          reason: "Invalid value shape",
          replacementValues: { brokerFee: "25.00" },
        }),
      );
    }

    await expectDatabaseError(client, "23503", () =>
      database.insert(policyOverrides).values({
        approvedByUserId: approver.id,
        originalValues: { brokerFee: "0.00" },
        policyId: randomUUID(),
        reason: "Missing policy",
        replacementValues: { brokerFee: "25.00" },
      }),
    );
    await expectDatabaseError(client, "23502", () =>
      database.insert(policyOverrides).values({
        approvedByUserId: approver.id,
        originalValues: { brokerFee: "0.00" },
        policyId: policy.id,
        reason: null as never,
        replacementValues: { brokerFee: "25.00" },
      }),
    );
    await expectDatabaseError(client, "23503", () =>
      database.insert(policyOverrides).values({
        approvedByUserId: randomUUID(),
        originalValues: { brokerFee: "0.00" },
        policyId: policy.id,
        reason: "Missing actor",
        replacementValues: { brokerFee: "25.00" },
      }),
    );
    await expectDatabaseError(client, "23001", () =>
      database.delete(policies).where(eq(policies.id, policy.id)),
    );
    await expectDatabaseError(client, "23001", () =>
      database.delete(users).where(eq(users.id, approver.id)),
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
