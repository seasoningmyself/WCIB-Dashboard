import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import { applyPolicyOverride } from "../policies/overrides.js";
import { readDatabaseErrorCode } from "./error-code.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "./policy-test-fixture.js";
import {
  policies,
  policyOverrides,
  userCapabilities,
  users,
} from "./schema.js";
import * as databaseSchema from "./schema.js";

let savepointSequence = 0;

const logger: AppLogger = {
  error() {},
  info() {},
  warn() {},
};

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
    await database.insert(userCapabilities).values({
      capability: "admin",
      userId: approver.id,
    });
    const context: AuthorizedRequestContext = {
      principal: {
        capabilities: ["admin"],
        staffRole: null,
        userActive: true,
        userId: approver.id,
      },
    };
    const [policy] = await database
      .insert(policies)
      .values(
        policyTestInput(references, {
          amountPaid: "1000.00",
          basePremium: "1000.00",
          netDue: "1000.00",
          policyNumber: "OVERRIDE-SOURCE",
          proposalTotal: "1000.00",
          sourceDraftId: null,
        }),
      )
      .returning();
    assert.ok(policy);

    const overrideId = await applyPolicyOverride(
      database,
      context,
      policy.id,
      "Correct carrier statement figures",
      { brokerFee: "25.00", commissionAmount: "100.00" },
      ["brokerFee", "commissionAmount"],
      logger,
    );
    const [override] = await database
      .select()
      .from(policyOverrides)
      .where(eq(policyOverrides.id, overrideId));
    assert.ok(override);
    assert.equal(override.policyId, policy.id);
    assert.equal(override.approvedByUserId, approver.id);
    assert.deepEqual(override.originalValues, {
      brokerFee: "0.00",
      commissionAmount: "0.00",
      commissionMode: "na",
    });
    assert.deepEqual(override.replacementValues, {
      brokerFee: "25.00",
      commissionAmount: "100.00",
      commissionMode: "pct",
    });

    for (const invalidValues of [
      null,
      [],
      {},
      { insuredName: "Private insured" },
      { brokerFee: 25 },
      { brokerFee: "1".repeat(5_000) },
    ]) {
      await expectDatabaseError(client, "23514", () =>
        client.query(
          `select apply_policy_override(
             $1::uuid,
             $2::uuid,
             'Invalid value shape',
             $3::jsonb
           )`,
          [policy.id, approver.id, JSON.stringify(invalidValues)],
        ),
      );
    }

    await expectDatabaseError(client, "P0002", () =>
      client.query(
        `select apply_policy_override(
           $1::uuid,
           $2::uuid,
           'Missing policy',
           '{"brokerFee":"25.00"}'::jsonb
         )`,
        [randomUUID(), approver.id],
      ),
    );
    await expectDatabaseError(client, "22004", () =>
      client.query(
        `select apply_policy_override(
           $1::uuid,
           $2::uuid,
           null,
           '{"brokerFee":"25.00"}'::jsonb
         )`,
        [policy.id, approver.id],
      ),
    );
    await expectDatabaseError(client, "42501", () =>
      client.query(
        `select apply_policy_override(
           $1::uuid,
           $2::uuid,
           'Missing actor',
           '{"brokerFee":"25.00"}'::jsonb
         )`,
        [policy.id, randomUUID()],
      ),
    );
    await expectDatabaseError(client, "55000", () =>
      database.insert(policyOverrides).values({
        approvedByUserId: approver.id,
        originalValues: { brokerFee: "0.00" },
        policyId: policy.id,
        reason: "Direct insert is forbidden",
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
