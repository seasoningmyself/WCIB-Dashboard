import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import type { AppLogger, LogContext } from "../logging/logger.js";
import { closePaySheet } from "../pay-sheets/close.js";
import { syncMgaPaymentSheetPlacement } from "../pay-sheets/mga-placement.js";
import { setMgaPaymentState } from "../policies/mga-payments.js";
import { withDisposableMigratedDatabase } from "./disposable-database-test-helper.js";
import { readDatabaseErrorCode } from "./error-code.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "./policy-test-fixture.js";
import {
  auditEvents,
  paySheetPolicies,
  paySheets,
  policies,
  producerRateHistory,
  userCapabilities,
} from "./schema.js";
import * as databaseSchema from "./schema.js";

let savepointSequence = 0;

async function expectDatabaseError(
  client: pg.PoolClient,
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  const savepoint = `expected_mga_placement_error_${savepointSequence++}`;
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

function context(userId: string): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: ["admin"],
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

test("concurrent MGA placement calls cannot duplicate associations", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for MGA placement DB test");

  await withDisposableMigratedDatabase(databaseUrl, "wcib_stone76_race", async (isolatedUrl) => {
    const pool = new pg.Pool({ connectionString: isolatedUrl, max: 3 });
    const database = drizzle(pool, { schema: databaseSchema });
    const loggedEvents: LoggedEvent[] = [];
    const logger = capturingLogger(loggedEvents);

    try {
      const references = await createPolicyReferenceFixture(database);
      const admin = await createUser(database, {
        email: `mga-placement-race-admin-${randomUUID()}@example.test`,
        password: "StrongPass123!",
      });
      await database.insert(userCapabilities).values({
        capability: "admin",
        userId: admin.id,
      });
      const adminContext = context(admin.id);
      const createdAt = new Date("2026-07-01T12:00:00.000Z");
      const [sophiaSheet, producerSheet] = await database
        .insert(paySheets)
        .values([
          {
            createdAt,
            openedAt: createdAt,
            ownerType: "sophia",
            ownerUserId: admin.id,
            periodMonth: 7,
            periodYear: 2026,
            updatedAt: createdAt,
          },
          {
            createdAt,
            openedAt: createdAt,
            ownerType: "producer",
            ownerUserId: references.producerUserId,
            periodMonth: 7,
            periodYear: 2026,
            updatedAt: createdAt,
          },
        ])
        .returning();
      assert.ok(sophiaSheet);
      assert.ok(producerSheet);

      const [policy] = await database
        .insert(policies)
        .values(
          policyTestInput(references, {
            createdAt,
            kayleeSplit: "book",
            policyNumber: "PLACEMENT-RACE",
            producerUserId: references.producerUserId,
            sourceDraftId: null,
            updatedAt: createdAt,
          }),
        )
        .returning();
      assert.ok(policy);
      const paidAt = new Date("2026-07-02T12:00:00.000Z");
      await setMgaPaymentState(
        database,
        adminContext,
        policy.id,
        "paid",
        null,
        logger,
        paidAt,
      );

      // Hold the first placement long enough for the second session to block
      // on the policy row lock rather than merely running afterward.
      await pool.query(`
        CREATE FUNCTION slow_mga_sheet_attachment_for_test()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          PERFORM pg_sleep(0.15);
          RETURN NEW;
        END;
        $$
      `);
      await pool.query(`
        CREATE TRIGGER slow_mga_sheet_attachment_for_test_trigger
        BEFORE INSERT ON pay_sheet_policies
        FOR EACH ROW
        EXECUTE FUNCTION slow_mga_sheet_attachment_for_test()
      `);

      const [firstClient, secondClient] = await Promise.all([
        pool.connect(),
        pool.connect(),
      ]);
      try {
        const [first, second] = await Promise.all([
          syncMgaPaymentSheetPlacement(
            drizzle(firstClient, { schema: databaseSchema }),
            adminContext,
            policy.id,
            true,
            logger,
            paidAt,
          ),
          syncMgaPaymentSheetPlacement(
            drizzle(secondClient, { schema: databaseSchema }),
            adminContext,
            policy.id,
            true,
            logger,
            paidAt,
          ),
        ]);
        assert.deepEqual(
          [first.associationCount, second.associationCount].sort(
            (left, right) => left - right,
          ),
          [0, 2],
        );
      } finally {
        firstClient.release();
        secondClient.release();
      }

      const associations = await database
        .select()
        .from(paySheetPolicies)
        .where(eq(paySheetPolicies.policyId, policy.id));
      assert.equal(associations.length, 2);
      assert.deepEqual(
        new Set(associations.map((association) => association.paySheetId)),
        new Set([sophiaSheet.id, producerSheet.id]),
      );
      const attachmentAudits = await database
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.action, "mga_payment_sheet_attached"),
            eq(auditEvents.entityType, "pay_sheet_policy"),
          ),
        );
      assert.equal(attachmentAudits.length, 2);
    } finally {
      await pool.end();
    }
  });
});

test("MGA placement attaches applicable open chains and preserves closed history", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for MGA placement DB test");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const database = drizzle(client, { schema: databaseSchema });
  const loggedEvents: LoggedEvent[] = [];
  const logger = capturingLogger(loggedEvents);

  try {
    await client.query("BEGIN");
    const references = await createPolicyReferenceFixture(database);
    const admin = await createUser(database, {
      email: `mga-placement-admin-${randomUUID()}@example.test`,
      password: "StrongPass123!",
    });
    await database.insert(userCapabilities).values({
      capability: "admin",
      userId: admin.id,
    });
    const adminContext = context(admin.id);
    const createdAt = new Date("2026-06-01T12:00:00.000Z");
    const paidAt = new Date("2026-07-02T12:00:00.000Z");
    const [sophiaJune, producerJune] = await database
      .insert(paySheets)
      .values([
        {
          createdAt,
          openedAt: createdAt,
          ownerType: "sophia",
          ownerUserId: admin.id,
          periodMonth: 6,
          periodYear: 2026,
          updatedAt: createdAt,
        },
        {
          createdAt,
          openedAt: createdAt,
          ownerType: "producer",
          ownerUserId: references.producerUserId,
          periodMonth: 6,
          periodYear: 2026,
          updatedAt: createdAt,
        },
      ])
      .returning();
    assert.ok(sophiaJune);
    assert.ok(producerJune);

    await database.insert(producerRateHistory).values({
      effectiveDate: "2000-01-01",
      newBrokerRate: "25.00",
      newCommissionRate: "25.00",
      producerUserId: references.producerUserId,
      renewalBrokerRate: "25.00",
      renewalCommissionRate: "25.00",
    });

    const financialPolicyValues = {
      amountPaid: "1000.00",
      basePremium: "1000.00",
      brokerFee: "50.00",
      commissionAmount: "100.00",
      commissionConfirmed: true,
      commissionMode: "pct" as const,
      commissionRate: "10.0000",
      createdAt,
      financeBalance: "0.00",
      netDue: "850.00",
      paymentMode: "full" as const,
      proposalTotal: "1050.00",
      sourceDraftId: null,
      updatedAt: createdAt,
    };
    const [assignedPolicy, laterAssignedPolicy, rollbackPolicy] = await database
      .insert(policies)
      .values([
        policyTestInput(references, {
          ...financialPolicyValues,
          kayleeSplit: "book",
          policyNumber: "PLACEMENT-ASSIGNED",
          producerUserId: references.producerUserId,
        }),
        policyTestInput(references, {
          ...financialPolicyValues,
          kayleeSplit: "none",
          policyNumber: "PLACEMENT-LATER-ASSIGNED",
          producerUserId: null,
        }),
        policyTestInput(references, {
          ...financialPolicyValues,
          kayleeSplit: "none",
          policyNumber: "PLACEMENT-ROLLBACK",
          producerUserId: null,
        }),
      ])
      .returning();
    assert.ok(assignedPolicy);
    assert.ok(laterAssignedPolicy);
    assert.ok(rollbackPolicy);

    await setMgaPaymentState(
      database,
      adminContext,
      assignedPolicy.id,
      "paid",
      "SECRET-ASSIGNED-REF",
      logger,
      paidAt,
    );
    const attached = await syncMgaPaymentSheetPlacement(
      database,
      adminContext,
      assignedPolicy.id,
      true,
      logger,
      paidAt,
    );
    assert.equal(attached.associationCount, 2);
    assert.deepEqual(new Set(attached.paySheetIds), new Set([
      sophiaJune.id,
      producerJune.id,
    ]));

    const assignedAssociations = await database
      .select()
      .from(paySheetPolicies)
      .where(eq(paySheetPolicies.policyId, assignedPolicy.id));
    assert.equal(assignedAssociations.length, 2);
    assert.equal(
      assignedAssociations.every(
        (association) =>
          association.frozenPolicySnapshot === null &&
          association.frozenRateSnapshot === null,
      ),
      true,
    );

    const repeated = await syncMgaPaymentSheetPlacement(
      database,
      adminContext,
      assignedPolicy.id,
      true,
      logger,
      new Date("2026-07-02T13:00:00.000Z"),
    );
    assert.deepEqual(repeated, { associationCount: 0, paySheetIds: [] });
    const assignedAttachmentAudits = await database
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "mga_payment_sheet_attached"),
          eq(auditEvents.entityType, "pay_sheet_policy"),
        ),
      );
    assert.equal(assignedAttachmentAudits.length, 2);

    await expectDatabaseError(client, "55000", () =>
      database.insert(paySheetPolicies).values({
        paySheetId: sophiaJune.id,
        policyId: rollbackPolicy.id,
      }),
    );
    await expectDatabaseError(client, "55000", () =>
      database
        .delete(paySheetPolicies)
        .where(eq(paySheetPolicies.id, assignedAssociations[0]!.id)),
    );

    await setMgaPaymentState(
      database,
      adminContext,
      laterAssignedPolicy.id,
      "paid",
      null,
      logger,
      paidAt,
    );
    const initialSophiaOnly = await syncMgaPaymentSheetPlacement(
      database,
      adminContext,
      laterAssignedPolicy.id,
      true,
      logger,
      paidAt,
    );
    assert.deepEqual(initialSophiaOnly, {
      associationCount: 1,
      paySheetIds: [sophiaJune.id],
    });

    const producerClose = await closePaySheet(
      database,
      adminContext,
      producerJune.id,
      logger,
    );
    const sophiaClose = await closePaySheet(
      database,
      adminContext,
      sophiaJune.id,
      logger,
    );
    const [closedSophiaAssociation] = await database
      .select()
      .from(paySheetPolicies)
      .where(
        and(
          eq(paySheetPolicies.paySheetId, sophiaJune.id),
          eq(paySheetPolicies.policyId, laterAssignedPolicy.id),
        ),
      );
    assert.ok(closedSophiaAssociation);
    const closedAt = new Date("2026-07-03T12:00:00.000Z");
    const [closedBeforeDetach] = await database
      .select()
      .from(paySheetPolicies)
      .where(eq(paySheetPolicies.id, closedSophiaAssociation.id));
    assert.ok(closedBeforeDetach);

    await database
      .update(policies)
      .set({
        kayleeSplit: "book",
        producerUserId: references.producerUserId,
        updatedAt: closedAt,
      })
      .where(eq(policies.id, laterAssignedPolicy.id));
    const [sophiaJuly] = await database
      .select()
      .from(paySheets)
      .where(eq(paySheets.id, sophiaClose.nextSheetId));
    const [producerJuly] = await database
      .select()
      .from(paySheets)
      .where(eq(paySheets.id, producerClose.nextSheetId));
    assert.ok(sophiaJuly);
    assert.ok(producerJuly);

    const producerRepair = await syncMgaPaymentSheetPlacement(
      database,
      adminContext,
      laterAssignedPolicy.id,
      true,
      logger,
      new Date("2026-07-04T12:00:00.000Z"),
    );
    assert.deepEqual(producerRepair, {
      associationCount: 1,
      paySheetIds: [producerJuly.id],
    });
    assert.equal(producerRepair.paySheetIds.includes(sophiaJuly.id), false);

    await setMgaPaymentState(
      database,
      adminContext,
      laterAssignedPolicy.id,
      "unpaid",
      "must-be-cleared",
      logger,
      new Date("2026-07-05T12:00:00.000Z"),
    );
    const detached = await syncMgaPaymentSheetPlacement(
      database,
      adminContext,
      laterAssignedPolicy.id,
      false,
      logger,
      new Date("2026-07-05T12:00:00.000Z"),
    );
    assert.deepEqual(detached, {
      associationCount: 1,
      paySheetIds: [producerJuly.id],
    });
    const [closedAfterDetach] = await database
      .select()
      .from(paySheetPolicies)
      .where(eq(paySheetPolicies.id, closedSophiaAssociation.id));
    assert.deepEqual(closedAfterDetach, closedBeforeDetach);
    assert.deepEqual(
      await database
        .select()
        .from(paySheetPolicies)
        .where(
          and(
            eq(paySheetPolicies.paySheetId, producerJuly.id),
            eq(paySheetPolicies.policyId, laterAssignedPolicy.id),
          ),
        ),
      [],
    );
    await expectDatabaseError(client, "55000", () =>
      database
        .delete(paySheetPolicies)
        .where(eq(paySheetPolicies.id, closedSophiaAssociation.id)),
    );

    await setMgaPaymentState(
      database,
      adminContext,
      rollbackPolicy.id,
      "paid",
      "ROLLBACK-SECRET",
      logger,
      new Date("2026-07-06T12:00:00.000Z"),
    );
    await client.query(`
      CREATE FUNCTION fail_mga_sheet_audit_for_test()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.action = 'mga_payment_sheet_attached' THEN
          RAISE EXCEPTION 'forced attachment audit failure' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await client.query(`
      CREATE TRIGGER fail_mga_sheet_audit_for_test_trigger
      BEFORE INSERT ON audit_events
      FOR EACH ROW
      EXECUTE FUNCTION fail_mga_sheet_audit_for_test()
    `);
    await expectDatabaseError(client, "55000", () =>
      syncMgaPaymentSheetPlacement(
        database,
        adminContext,
        rollbackPolicy.id,
        true,
        logger,
        new Date("2026-07-06T12:00:00.000Z"),
      ),
    );
    await client.query(
      "DROP TRIGGER fail_mga_sheet_audit_for_test_trigger ON audit_events",
    );
    await client.query("DROP FUNCTION fail_mga_sheet_audit_for_test() ");
    const rollbackAssociations = await database
      .select()
      .from(paySheetPolicies)
      .where(eq(paySheetPolicies.policyId, rollbackPolicy.id));
    assert.deepEqual(rollbackAssociations, []);

    const serializedLogs = JSON.stringify(loggedEvents);
    for (const forbidden of [
      "SECRET-ASSIGNED-REF",
      "ROLLBACK-SECRET",
      "must-be-cleared",
      "150.00",
    ]) {
      assert.equal(serializedLogs.includes(forbidden), false);
    }
    assert.equal(
      loggedEvents.some(
        (event) => event.context.event === "mga_pay_sheet_placement_succeeded",
      ),
      true,
    );
    assert.equal(
      loggedEvents.some(
        (event) => event.context.event === "mga_pay_sheet_placement_failed",
      ),
      true,
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
