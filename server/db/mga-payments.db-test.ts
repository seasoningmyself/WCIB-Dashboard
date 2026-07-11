import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import { setMgaPaymentState } from "../policies/mga-payments.js";
import { readDatabaseErrorCode } from "./error-code.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "./policy-test-fixture.js";
import {
  mgaPayments,
  policies,
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
  const savepoint = `expected_mga_payment_error_${savepointSequence++}`;
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

test("MGA payment rows enforce one UUID-linked current settlement state", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for MGA payment DB test");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const database = drizzle(client, { schema: databaseSchema });

  try {
    await client.query("BEGIN");
    const references = await createPolicyReferenceFixture(database);
    const admin = await createUser(database, {
      email: `mga-payment-admin-${randomUUID()}@example.test`,
      password: "StrongPass123!",
    });
    await database.insert(userCapabilities).values({
      capability: "admin",
      userId: admin.id,
    });
    const context: AuthorizedRequestContext = {
      principal: {
        capabilities: ["admin"],
        staffRole: null,
        userActive: true,
        userId: admin.id,
      },
    };
    const createdAt = new Date("2026-07-01T12:00:00.000Z");
    const paidAt = new Date("2026-07-02T12:00:00.000Z");
    const [policy] = await database
      .insert(policies)
      .values(
        policyTestInput(references, {
          createdAt,
          policyNumber: "MGA-PAYMENT-STATE",
          sourceDraftId: null,
          updatedAt: createdAt,
        }),
      )
      .returning();
    assert.ok(policy);

    const paymentId = await setMgaPaymentState(
      database,
      context,
      policy.id,
      "unpaid",
      null,
      logger,
      paidAt,
    );
    const [payment] = await database
      .select()
      .from(mgaPayments)
      .where(eq(mgaPayments.id, paymentId));
    assert.ok(payment);
    assert.match(payment.id, /^[0-9a-f-]{36}$/);
    assert.equal(payment.policyId, policy.id);
    assert.equal(payment.status, "unpaid");
    assert.equal(payment.reference, null);
    assert.equal(payment.paidAt, null);
    assert.equal(payment.adminActorUserId, null);

    await expectDatabaseError(client, "55000", () =>
      database.insert(mgaPayments).values({ policyId: policy.id }),
    );
    await expectDatabaseError(client, "55000", () =>
      database
        .update(mgaPayments)
        .set({ status: "paid", updatedAt: paidAt })
        .where(eq(mgaPayments.id, payment.id)),
    );

    await setMgaPaymentState(
      database,
      context,
      policy.id,
      "paid",
      "WIRE-2026-07-02",
      logger,
      new Date("2026-07-03T12:00:00.000Z"),
    );
    const [paid] = await database
      .select()
      .from(mgaPayments)
      .where(eq(mgaPayments.id, payment.id));
    assert.equal(paid?.status, "paid");
    assert.equal(paid?.adminActorUserId, admin.id);
    assert.equal(paid?.reference, "WIRE-2026-07-02");

    await expectDatabaseError(client, "P0002", () =>
      setMgaPaymentState(
        database,
        context,
        randomUUID(),
        "unpaid",
        null,
        logger,
      ),
    );
    await expectDatabaseError(client, "23001", () =>
      database.delete(policies).where(eq(policies.id, policy.id)),
    );
    await expectDatabaseError(client, "23001", () =>
      database.delete(users).where(eq(users.id, admin.id)),
    );

    await setMgaPaymentState(
      database,
      context,
      policy.id,
      "paid",
      null,
      logger,
      new Date("2026-07-04T12:00:00.000Z"),
    );
    const [paidWithoutReference] = await database
      .select()
      .from(mgaPayments)
      .where(eq(mgaPayments.id, payment.id));
    assert.equal(paidWithoutReference?.status, "paid");
    assert.equal(paidWithoutReference?.reference, null);

    const unpaidAt = new Date("2026-07-05T12:00:00.000Z");
    await setMgaPaymentState(
      database,
      context,
      policy.id,
      "unpaid",
      null,
      logger,
      unpaidAt,
    );
    const [unpaid] = await database
      .select()
      .from(mgaPayments)
      .where(eq(mgaPayments.id, payment.id));
    assert.equal(unpaid?.status, "unpaid");
    assert.equal(unpaid?.adminActorUserId, null);
    assert.equal(unpaid?.paidAt, null);
    assert.equal(unpaid?.reference, null);
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
