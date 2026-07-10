import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import type { AppLogger, LogContext } from "../logging/logger.js";
import { applyPolicyOverride } from "../policies/overrides.js";
import { readDatabaseErrorCode } from "./error-code.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "./policy-test-fixture.js";
import {
  auditEvents,
  policies,
  policyOverrides,
  userCapabilities,
} from "./schema.js";
import * as databaseSchema from "./schema.js";

let savepointSequence = 0;

async function expectDatabaseError(
  client: pg.PoolClient,
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  const savepoint = `expected_override_integrity_error_${savepointSequence++}`;
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

test("policy overrides are admin-only, append-only, and atomically audited", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for override integrity test");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const database = drizzle(client, { schema: databaseSchema });
  const loggedEvents: LoggedEvent[] = [];
  const logger = capturingLogger(loggedEvents);

  try {
    await client.query("BEGIN");
    const references = await createPolicyReferenceFixture(database);
    const admin = await createUser(database, {
      email: `override-admin-${randomUUID()}@example.test`,
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
    const overrideCreatedAt = new Date("2026-07-02T12:00:00.000Z");
    const [policy] = await database
      .insert(policies)
      .values(
        policyTestInput(references, {
          amountPaid: "1200.00",
          basePremium: "1000.00",
          brokerFee: "50.00",
          commissionAmount: "100.00",
          commissionConfirmed: true,
          commissionMode: "pct",
          commissionRate: "10.0000",
          createdAt: policyCreatedAt,
          mgaFee: "50.00",
          netDue: "1050.00",
          policyNumber: "OVERRIDE-INTEGRITY",
          proposalTotal: "1200.00",
          sourceDraftId: null,
          taxes: "100.00",
          updatedAt: policyCreatedAt,
        }),
      )
      .returning();
    assert.ok(policy);

    const reason = "Correct values from the carrier statement";
    const overrideId = await applyPolicyOverride(
      database,
      adminContext,
      policy.id,
      reason,
      {
        approvedByUserId: references.submittedByUserId,
        brokerFee: "75.00",
        commissionAmount: "125.00",
        insuredName: "Must not be stored",
        originalValues: { brokerFee: "999999.00" },
      },
      ["brokerFee", "commissionAmount"],
      logger,
      overrideCreatedAt,
    );

    const [updatedPolicy] = await database
      .select()
      .from(policies)
      .where(eq(policies.id, policy.id));
    const [storedOverride] = await database
      .select()
      .from(policyOverrides)
      .where(eq(policyOverrides.id, overrideId));
    const [storedAudit] = await database
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, overrideId));

    assert.equal(updatedPolicy?.brokerFee, "75.00");
    assert.equal(updatedPolicy?.commissionAmount, "125.00");
    assert.equal(updatedPolicy?.proposalTotal, "1225.00");
    assert.equal(updatedPolicy?.netDue, "1000.00");
    assert.equal(updatedPolicy?.overridden, true);
    assert.deepEqual(storedOverride?.originalValues, {
      brokerFee: "50.00",
      commissionAmount: "100.00",
    });
    assert.deepEqual(storedOverride?.replacementValues, {
      brokerFee: "75.00",
      commissionAmount: "125.00",
    });
    assert.equal(storedOverride?.approvedByUserId, admin.id);
    assert.equal(storedOverride?.reason, reason);
    assert.equal(storedAudit?.action, "policy_override_applied");
    assert.equal(storedAudit?.entityType, "policy_override");
    assert.equal(storedAudit?.actorUserId, admin.id);
    assert.equal(storedAudit?.beforeSummary, null);
    assert.deepEqual(storedAudit?.afterSummary, { policyId: policy.id });

    await expectDatabaseError(client, "55000", () =>
      database
        .update(policyOverrides)
        .set({ reason: "Rewrite history" })
        .where(eq(policyOverrides.id, overrideId)),
    );
    await expectDatabaseError(client, "55000", () =>
      database.delete(policyOverrides).where(eq(policyOverrides.id, overrideId)),
    );
    await expectDatabaseError(client, "55000", () =>
      database.insert(policyOverrides).values({
        approvedByUserId: references.submittedByUserId,
        originalValues: { brokerFee: "75.00" },
        policyId: policy.id,
        reason: "Forge original and actor",
        replacementValues: { brokerFee: "80.00" },
      }),
    );
    await expectDatabaseError(client, "55000", () =>
      database
        .update(policies)
        .set({ brokerFee: "80.00" })
        .where(eq(policies.id, policy.id)),
    );
    await expectDatabaseError(client, "23514", () =>
      applyPolicyOverride(
        database,
        adminContext,
        policy.id,
        "   ",
        { brokerFee: "80.00" },
        ["brokerFee"],
        logger,
        new Date("2026-07-03T12:00:00.000Z"),
      ),
    );
    await expectDatabaseError(client, "23514", () =>
      applyPolicyOverride(
        database,
        adminContext,
        policy.id,
        "No actual change",
        { brokerFee: "75.00" },
        ["brokerFee"],
        logger,
        new Date("2026-07-03T12:00:00.000Z"),
      ),
    );
    await expectDatabaseError(client, "42501", () =>
      applyPolicyOverride(
        database,
        forgedEmployeeContext,
        policy.id,
        "Forged client capability",
        { brokerFee: "80.00" },
        ["brokerFee"],
        logger,
        new Date("2026-07-03T12:00:00.000Z"),
      ),
    );

    const beforeFailedAudit = await client.query<{
      audit_count: string;
      override_count: string;
    }>(
      `select
         (select count(*) from audit_events)::text as audit_count,
         (select count(*) from policy_overrides)::text as override_count`,
    );
    await client.query(`
      CREATE FUNCTION fail_policy_override_audit_for_test()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.action = 'policy_override_applied' THEN
          RAISE EXCEPTION 'forced audit failure' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await client.query(`
      CREATE TRIGGER fail_policy_override_audit_for_test_trigger
      BEFORE INSERT ON audit_events
      FOR EACH ROW
      EXECUTE FUNCTION fail_policy_override_audit_for_test()
    `);

    await expectDatabaseError(client, "55000", () =>
      applyPolicyOverride(
        database,
        adminContext,
        policy.id,
        "This transaction must roll back",
        { brokerFee: "80.00" },
        ["brokerFee"],
        logger,
        new Date("2026-07-04T12:00:00.000Z"),
      ),
    );
    await client.query(
      "DROP TRIGGER fail_policy_override_audit_for_test_trigger ON audit_events",
    );
    await client.query("DROP FUNCTION fail_policy_override_audit_for_test() ");

    const [afterFailedPolicy] = await database
      .select()
      .from(policies)
      .where(eq(policies.id, policy.id));
    const afterFailedAudit = await client.query<{
      audit_count: string;
      override_count: string;
    }>(
      `select
         (select count(*) from audit_events)::text as audit_count,
         (select count(*) from policy_overrides)::text as override_count`,
    );
    assert.equal(afterFailedPolicy?.brokerFee, "75.00");
    assert.deepEqual(afterFailedAudit.rows, beforeFailedAudit.rows);

    assert.equal(
      loggedEvents.some(
        (event) => event.context.event === "override_succeeded",
      ),
      true,
    );
    assert.equal(
      loggedEvents.some((event) => event.context.event === "override_failed"),
      true,
    );
    const serializedLogs = JSON.stringify(loggedEvents);
    for (const forbidden of [
      reason,
      "Must not be stored",
      "50.00",
      "75.00",
      "100.00",
      "125.00",
    ]) {
      assert.equal(serializedLogs.includes(forbidden), false);
    }
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
