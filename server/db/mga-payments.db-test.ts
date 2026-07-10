import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createUser } from "../auth/users.js";
import { readDatabaseErrorCode } from "./error-code.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "./policy-test-fixture.js";
import { mgaPayments, policies, users } from "./schema.js";
import * as databaseSchema from "./schema.js";

let savepointSequence = 0;

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

    const [payment] = await database
      .insert(mgaPayments)
      .values({ createdAt, policyId: policy.id, updatedAt: createdAt })
      .returning();
    assert.ok(payment);
    assert.match(payment.id, /^[0-9a-f-]{36}$/);
    assert.equal(payment.policyId, policy.id);
    assert.equal(payment.status, "unpaid");
    assert.equal(payment.reference, null);
    assert.equal(payment.paidAt, null);
    assert.equal(payment.adminActorUserId, null);

    await expectDatabaseError(client, "23505", () =>
      database.insert(mgaPayments).values({ policyId: policy.id }),
    );
    await expectDatabaseError(client, "23514", () =>
      database
        .update(mgaPayments)
        .set({ status: "paid", updatedAt: paidAt })
        .where(eq(mgaPayments.id, payment.id)),
    );
    await expectDatabaseError(client, "23514", () =>
      database
        .update(mgaPayments)
        .set({ reference: "UNPAID-REF" })
        .where(eq(mgaPayments.id, payment.id)),
    );
    await expectDatabaseError(client, "23514", () =>
      database
        .update(mgaPayments)
        .set({ updatedAt: new Date("2026-06-30T12:00:00.000Z") })
        .where(eq(mgaPayments.id, payment.id)),
    );

    const [paid] = await database
      .update(mgaPayments)
      .set({
        adminActorUserId: admin.id,
        paidAt,
        reference: "WIRE-2026-07-02",
        status: "paid",
        updatedAt: paidAt,
      })
      .where(eq(mgaPayments.id, payment.id))
      .returning();
    assert.equal(paid?.status, "paid");
    assert.equal(paid?.adminActorUserId, admin.id);
    assert.equal(paid?.reference, "WIRE-2026-07-02");

    await expectDatabaseError(client, "23514", () =>
      database
        .update(mgaPayments)
        .set({ reference: "   " })
        .where(eq(mgaPayments.id, payment.id)),
    );
    await expectDatabaseError(client, "23514", () =>
      database
        .update(mgaPayments)
        .set({ status: "unpaid" })
        .where(eq(mgaPayments.id, payment.id)),
    );
    await expectDatabaseError(client, "23503", () =>
      database
        .update(mgaPayments)
        .set({ adminActorUserId: randomUUID() })
        .where(eq(mgaPayments.id, payment.id)),
    );
    await expectDatabaseError(client, "23503", () =>
      database.insert(mgaPayments).values({ policyId: randomUUID() }),
    );
    await expectDatabaseError(client, "23001", () =>
      database.delete(policies).where(eq(policies.id, policy.id)),
    );
    await expectDatabaseError(client, "23001", () =>
      database.delete(users).where(eq(users.id, admin.id)),
    );

    const [paidWithoutReference] = await database
      .update(mgaPayments)
      .set({ reference: null })
      .where(eq(mgaPayments.id, payment.id))
      .returning();
    assert.equal(paidWithoutReference?.status, "paid");
    assert.equal(paidWithoutReference?.reference, null);

    const unpaidAt = new Date("2026-07-03T12:00:00.000Z");
    const [unpaid] = await database
      .update(mgaPayments)
      .set({
        adminActorUserId: null,
        paidAt: null,
        reference: null,
        status: "unpaid",
        updatedAt: unpaidAt,
      })
      .where(eq(mgaPayments.id, payment.id))
      .returning();
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
