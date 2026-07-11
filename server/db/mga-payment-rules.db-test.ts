import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import type { AppLogger, LogContext } from "../logging/logger.js";
import { setMgaPaymentState } from "../policies/mga-payments.js";
import { readDatabaseErrorCode } from "./error-code.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "./policy-test-fixture.js";
import {
  auditEvents,
  mgaPayments,
  policies,
  userCapabilities,
} from "./schema.js";
import * as databaseSchema from "./schema.js";

let savepointSequence = 0;

async function expectDatabaseError(
  client: pg.PoolClient,
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  const savepoint = `expected_mga_rule_error_${savepointSequence++}`;
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

function context(
  userId: string,
  capabilities: AuthorizedRequestContext["principal"]["capabilities"],
): AuthorizedRequestContext {
  return {
    principal: {
      capabilities,
      staffRole: null,
      userActive: true,
      userId,
    },
  };
}

interface LoggedEvent {
  context: LogContext;
  level: "error" | "info" | "warn";
  message: string;
}

function capturingLogger(events: LoggedEvent[]): AppLogger {
  return {
    error(message, logContext = {}) {
      events.push({ context: logContext, level: "error", message });
    },
    info(message, logContext = {}) {
      events.push({ context: logContext, level: "info", message });
    },
    warn(message, logContext = {}) {
      events.push({ context: logContext, level: "warn", message });
    },
  };
}

async function countPaymentAudits(
  client: pg.PoolClient,
  paymentId: string,
): Promise<number> {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count
     from audit_events
     where entity_type = 'mga_payment'
       and entity_id = $1::uuid`,
    [paymentId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

test("MGA state transitions synchronize, audit, and remain idempotent", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for MGA rules DB test");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const database = drizzle(client, { schema: databaseSchema });
  const loggedEvents: LoggedEvent[] = [];
  const logger = capturingLogger(loggedEvents);

  try {
    await client.query("BEGIN");
    const references = await createPolicyReferenceFixture(database);
    const admin = await createUser(database, {
      email: `mga-rules-admin-${randomUUID()}@example.test`,
      password: "StrongPass123!",
    });
    await database.insert(userCapabilities).values({
      capability: "admin",
      userId: admin.id,
    });
    const adminContext = context(admin.id, ["admin"]);
    const forgedEmployeeContext = context(references.submittedByUserId, [
      "admin",
    ]);
    const policyCreatedAt = new Date("2026-07-01T12:00:00.000Z");
    const [policy] = await database
      .insert(policies)
      .values(
        policyTestInput(references, {
          createdAt: policyCreatedAt,
          policyNumber: "MGA-RULES",
          sourceDraftId: null,
          updatedAt: policyCreatedAt,
        }),
      )
      .returning();
    assert.ok(policy);

    const initializedAt = new Date("2026-07-02T12:00:00.000Z");
    const paymentId = await setMgaPaymentState(
      database,
      adminContext,
      policy.id,
      "unpaid",
      "ignored-on-unpaid",
      logger,
      initializedAt,
    );
    const [initializedPayment] = await database
      .select()
      .from(mgaPayments)
      .where(eq(mgaPayments.id, paymentId));
    assert.equal(initializedPayment?.status, "unpaid");
    assert.equal(initializedPayment?.reference, null);
    assert.equal(await countPaymentAudits(client, paymentId), 0);

    const repeatedUnpaidId = await setMgaPaymentState(
      database,
      adminContext,
      policy.id,
      "unpaid",
      null,
      logger,
      new Date("2026-07-02T13:00:00.000Z"),
    );
    const [repeatedUnpaid] = await database
      .select()
      .from(mgaPayments)
      .where(eq(mgaPayments.id, paymentId));
    assert.equal(repeatedUnpaidId, paymentId);
    assert.equal(repeatedUnpaid?.updatedAt.toISOString(), initializedAt.toISOString());
    assert.equal(await countPaymentAudits(client, paymentId), 0);

    await expectDatabaseError(client, "55000", () =>
      database
        .update(policies)
        .set({ mgaPaid: true, mgaPaidAt: initializedAt })
        .where(eq(policies.id, policy.id)),
    );
    await expectDatabaseError(client, "55000", () =>
      database
        .update(mgaPayments)
        .set({
          adminActorUserId: admin.id,
          paidAt: initializedAt,
          status: "paid",
        })
        .where(eq(mgaPayments.id, paymentId)),
    );
    await expectDatabaseError(client, "55000", () =>
      database.delete(mgaPayments).where(eq(mgaPayments.id, paymentId)),
    );

    const markedPaidAt = new Date("2026-07-03T12:00:00.000Z");
    const paidId = await setMgaPaymentState(
      database,
      adminContext,
      policy.id,
      "paid",
      "  WIRE-123  ",
      logger,
      markedPaidAt,
    );
    assert.equal(paidId, paymentId);
    const [paidPayment] = await database
      .select()
      .from(mgaPayments)
      .where(eq(mgaPayments.id, paymentId));
    const [paidPolicy] = await database
      .select()
      .from(policies)
      .where(eq(policies.id, policy.id));
    assert.equal(paidPayment?.status, "paid");
    assert.equal(paidPayment?.reference, "WIRE-123");
    assert.equal(paidPayment?.adminActorUserId, admin.id);
    assert.equal(paidPayment?.paidAt?.toISOString(), markedPaidAt.toISOString());
    assert.equal(paidPolicy?.mgaPaid, true);
    assert.equal(paidPolicy?.mgaPayReference, "WIRE-123");
    assert.equal(paidPolicy?.mgaPaidAt?.toISOString(), markedPaidAt.toISOString());
    assert.equal(await countPaymentAudits(client, paymentId), 1);

    const repeatedPaidId = await setMgaPaymentState(
      database,
      adminContext,
      policy.id,
      "paid",
      "WIRE-123",
      logger,
      new Date("2026-07-04T12:00:00.000Z"),
    );
    const [repeatedPaid] = await database
      .select()
      .from(mgaPayments)
      .where(eq(mgaPayments.id, paymentId));
    assert.equal(repeatedPaidId, paymentId);
    assert.equal(repeatedPaid?.updatedAt.toISOString(), markedPaidAt.toISOString());
    assert.equal(await countPaymentAudits(client, paymentId), 1);

    const referenceChangedAt = new Date("2026-07-05T12:00:00.000Z");
    await setMgaPaymentState(
      database,
      adminContext,
      policy.id,
      "paid",
      "WIRE-456",
      logger,
      referenceChangedAt,
    );
    const [referenceUpdated] = await database
      .select()
      .from(mgaPayments)
      .where(eq(mgaPayments.id, paymentId));
    assert.equal(referenceUpdated?.reference, "WIRE-456");
    assert.equal(referenceUpdated?.paidAt?.toISOString(), markedPaidAt.toISOString());
    assert.equal(referenceUpdated?.adminActorUserId, admin.id);
    assert.equal(await countPaymentAudits(client, paymentId), 2);

    const markedUnpaidAt = new Date("2026-07-06T12:00:00.000Z");
    await setMgaPaymentState(
      database,
      adminContext,
      policy.id,
      "unpaid",
      "must-be-cleared",
      logger,
      markedUnpaidAt,
    );
    const [unpaidPayment] = await database
      .select()
      .from(mgaPayments)
      .where(eq(mgaPayments.id, paymentId));
    const [unpaidPolicy] = await database
      .select()
      .from(policies)
      .where(eq(policies.id, policy.id));
    assert.equal(unpaidPayment?.status, "unpaid");
    assert.equal(unpaidPayment?.reference, null);
    assert.equal(unpaidPayment?.paidAt, null);
    assert.equal(unpaidPayment?.adminActorUserId, null);
    assert.equal(unpaidPolicy?.mgaPaid, false);
    assert.equal(unpaidPolicy?.mgaPayReference, null);
    assert.equal(unpaidPolicy?.mgaPaidAt, null);
    assert.equal(await countPaymentAudits(client, paymentId), 3);

    await expectDatabaseError(client, "42501", () =>
      setMgaPaymentState(
        database,
        forgedEmployeeContext,
        policy.id,
        "paid",
        "FORGED-REF",
        logger,
        new Date("2026-07-07T12:00:00.000Z"),
      ),
    );
    await expectDatabaseError(client, "P0002", () =>
      setMgaPaymentState(
        database,
        adminContext,
        randomUUID(),
        "paid",
        null,
        logger,
        new Date("2026-07-07T12:00:00.000Z"),
      ),
    );

    await client.query(`
      CREATE FUNCTION fail_mga_payment_audit_for_test()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.action = 'mga_payment_marked_paid' THEN
          RAISE EXCEPTION 'forced audit failure' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await client.query(`
      CREATE TRIGGER fail_mga_payment_audit_for_test_trigger
      BEFORE INSERT ON audit_events
      FOR EACH ROW
      EXECUTE FUNCTION fail_mga_payment_audit_for_test()
    `);
    await expectDatabaseError(client, "55000", () =>
      setMgaPaymentState(
        database,
        adminContext,
        policy.id,
        "paid",
        "ROLLBACK-REF",
        logger,
        new Date("2026-07-08T12:00:00.000Z"),
      ),
    );
    await client.query(
      "DROP TRIGGER fail_mga_payment_audit_for_test_trigger ON audit_events",
    );
    await client.query("DROP FUNCTION fail_mga_payment_audit_for_test() ");

    const [afterAuditFailurePayment] = await database
      .select()
      .from(mgaPayments)
      .where(eq(mgaPayments.id, paymentId));
    const [afterAuditFailurePolicy] = await database
      .select()
      .from(policies)
      .where(eq(policies.id, policy.id));
    assert.equal(afterAuditFailurePayment?.status, "unpaid");
    assert.equal(afterAuditFailurePayment?.reference, null);
    assert.equal(afterAuditFailurePolicy?.mgaPaid, false);
    assert.equal(await countPaymentAudits(client, paymentId), 3);

    const [audit] = await database
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, paymentId));
    assert.deepEqual(Object.keys(audit?.afterSummary ?? {}).sort(), [
      "policyId",
      "status",
    ]);
    const serializedLogs = JSON.stringify(loggedEvents);
    for (const forbidden of [
      "WIRE-123",
      "WIRE-456",
      "FORGED-REF",
      "ROLLBACK-REF",
      "must-be-cleared",
    ]) {
      assert.equal(serializedLogs.includes(forbidden), false);
    }
    assert.equal(
      loggedEvents.some(
        (event) => event.context.event === "mga_payment_transition_succeeded",
      ),
      true,
    );
    assert.equal(
      loggedEvents.some(
        (event) => event.context.event === "mga_payment_transition_failed",
      ),
      true,
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
