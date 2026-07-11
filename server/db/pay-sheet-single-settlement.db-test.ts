import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
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

interface LoggedEvent {
  context: LogContext;
  level: "error" | "info" | "warn";
  message: string;
}

function capturingLogger(events: LoggedEvent[]): AppLogger {
  return {
    error(message, context = {}) {
      events.push({ context, level: "error", message });
    },
    info(message, context = {}) {
      events.push({ context, level: "info", message });
    },
    warn(message, context = {}) {
      events.push({ context, level: "warn", message });
    },
  };
}

function adminContext(userId: string): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: ["admin"],
      staffRole: null,
      userActive: true,
      userId,
    },
  };
}

async function insertWithPlacementContext(
  client: pg.PoolClient,
  paySheetId: string,
  policyId: string,
): Promise<void> {
  await client.query(
    "select set_config('wcib.pay_sheet_placement_context', 'placement', true)",
  );
  await client.query(
    "insert into pay_sheet_policies (pay_sheet_id, policy_id) values ($1, $2)",
    [paySheetId, policyId],
  );
}

test("single settlement allows dual owner chains and rejects replay under contention", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(
    databaseUrl,
    "DATABASE_URL is required for pay-sheet settlement DB test",
  );

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_stone67_settle",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 4 });
      const database = drizzle(pool, { schema: databaseSchema });
      const loggedEvents: LoggedEvent[] = [];
      const logger = capturingLogger(loggedEvents);

      try {
        const references = await createPolicyReferenceFixture(database);
        const admin = await createUser(database, {
          email: `single-settlement-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const context = adminContext(admin.id);
        const createdAt = new Date(Date.now() - 60_000);
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
        const policyCreatedAt = new Date(Date.now() - 30_000);
        const [policy] = await database
          .insert(policies)
          .values(
            policyTestInput(references, {
              amountPaid: "1000.00",
              basePremium: "1000.00",
              brokerFee: "50.00",
              commissionAmount: "100.00",
              commissionConfirmed: true,
              commissionMode: "pct",
              commissionRate: "10.0000",
              createdAt: policyCreatedAt,
              financeBalance: "0.00",
              kayleeSplit: "book",
              netDue: "850.00",
              paymentMode: "full",
              policyNumber: "SINGLE-SETTLEMENT",
              producerUserId: references.producerUserId,
              proposalTotal: "1050.00",
              sourceDraftId: null,
              updatedAt: policyCreatedAt,
            }),
          )
          .returning();
        assert.ok(policy);

        const paidAt = new Date();
        await setMgaPaymentState(
          database,
          context,
          policy.id,
          "paid",
          null,
          logger,
          paidAt,
        );
        const attached = await syncMgaPaymentSheetPlacement(
          database,
          context,
          policy.id,
          true,
          logger,
          paidAt,
        );
        assert.equal(attached.associationCount, 2);
        const producerClose = await closePaySheet(
          database,
          context,
          producerJune.id,
          logger,
        );
        const sophiaClose = await closePaySheet(
          database,
          context,
          sophiaJune.id,
          logger,
        );

        const closedAssociations = await database
          .select({
            ownerType: paySheets.ownerType,
            ownerUserId: paySheets.ownerUserId,
            policyId: paySheetPolicies.policyId,
            status: paySheets.status,
          })
          .from(paySheetPolicies)
          .innerJoin(paySheets, eq(paySheets.id, paySheetPolicies.paySheetId))
          .where(eq(paySheetPolicies.policyId, policy.id));
        assert.equal(closedAssociations.length, 2);
        assert.deepEqual(
          new Set(
            closedAssociations.map(
              (association) =>
                `${association.ownerType}:${association.ownerUserId}:${association.status}`,
            ),
          ),
          new Set([
            `sophia:${admin.id}:closed`,
            `producer:${references.producerUserId}:closed`,
          ]),
        );

        const unpaidAt = new Date();
        await setMgaPaymentState(
          database,
          context,
          policy.id,
          "unpaid",
          null,
          logger,
          unpaidAt,
        );
        assert.deepEqual(
          await syncMgaPaymentSheetPlacement(
            database,
            context,
            policy.id,
            false,
            logger,
            unpaidAt,
          ),
          { associationCount: 0, paySheetIds: [] },
        );
        const repaidAt = new Date();
        await setMgaPaymentState(
          database,
          context,
          policy.id,
          "paid",
          null,
          logger,
          repaidAt,
        );
        assert.deepEqual(
          await syncMgaPaymentSheetPlacement(
            database,
            context,
            policy.id,
            true,
            logger,
            repaidAt,
          ),
          { associationCount: 0, paySheetIds: [] },
        );

        const sophiaReplayClient = await pool.connect();
        try {
          await sophiaReplayClient.query("BEGIN");
          await assert.rejects(
            insertWithPlacementContext(
              sophiaReplayClient,
              sophiaClose.nextSheetId,
              policy.id,
            ),
            (error: unknown) => readDatabaseErrorCode(error) === "23505",
          );
        } finally {
          await sophiaReplayClient.query("ROLLBACK");
          sophiaReplayClient.release();
        }

        const firstClient = await pool.connect();
        const secondClient = await pool.connect();
        try {
          await firstClient.query("BEGIN");
          await secondClient.query("BEGIN");
          await firstClient.query(
            "select lock_pay_sheet_settlement_chain($1, $2, $3::pay_sheet_owner_type)",
            [policy.id, references.producerUserId, "producer"],
          );
          await firstClient.query(
            "select set_config('wcib.pay_sheet_placement_context', 'placement', true)",
          );
          await secondClient.query(
            "select set_config('wcib.pay_sheet_placement_context', 'placement', true)",
          );

          const secondAttempt = secondClient
            .query(
              "insert into pay_sheet_policies (pay_sheet_id, policy_id) values ($1, $2)",
              [producerClose.nextSheetId, policy.id],
            )
            .then(
              () => ({ error: undefined }),
              (error: unknown) => ({ error }),
            );
          const contentionState = await Promise.race([
            secondAttempt.then(() => "settled" as const),
            delay(75, "blocked" as const),
          ]);
          assert.equal(contentionState, "blocked");

          await assert.rejects(
            firstClient.query(
              "insert into pay_sheet_policies (pay_sheet_id, policy_id) values ($1, $2)",
              [producerClose.nextSheetId, policy.id],
            ),
            (error: unknown) => readDatabaseErrorCode(error) === "23505",
          );
          await firstClient.query("ROLLBACK");
          const secondResult = await secondAttempt;
          assert.equal(readDatabaseErrorCode(secondResult.error), "23505");
        } finally {
          await firstClient.query("ROLLBACK").catch(() => undefined);
          await secondClient.query("ROLLBACK").catch(() => undefined);
          firstClient.release();
          secondClient.release();
        }

        assert.deepEqual(
          await database
            .select()
            .from(paySheetPolicies)
            .where(
              and(
                eq(paySheetPolicies.paySheetId, producerClose.nextSheetId),
                eq(paySheetPolicies.policyId, policy.id),
              ),
            ),
          [],
        );

        await pool.query(
          "alter table pay_sheet_policies disable trigger pay_sheet_policy_single_settlement_trigger",
        );
        const corruptionClient = await pool.connect();
        try {
          await corruptionClient.query("BEGIN");
          await insertWithPlacementContext(
            corruptionClient,
            producerClose.nextSheetId,
            policy.id,
          );
          await corruptionClient.query("COMMIT");
        } finally {
          await corruptionClient.query("ROLLBACK").catch(() => undefined);
          corruptionClient.release();
        }
        await pool.query(
          "alter table pay_sheet_policies enable trigger pay_sheet_policy_single_settlement_trigger",
        );

        await assert.rejects(
          closePaySheet(
            database,
            context,
            producerClose.nextSheetId,
            logger,
          ),
          (error: unknown) => readDatabaseErrorCode(error) === "23505",
        );
        const [replaySheet] = await database
          .select()
          .from(paySheets)
          .where(eq(paySheets.id, producerClose.nextSheetId));
        const [replayAssociation] = await database
          .select()
          .from(paySheetPolicies)
          .where(
            and(
              eq(paySheetPolicies.paySheetId, producerClose.nextSheetId),
              eq(paySheetPolicies.policyId, policy.id),
            ),
          );
        assert.equal(replaySheet?.status, "open");
        assert.equal(replaySheet?.frozenTotals, null);
        assert.equal(replayAssociation?.frozenPolicySnapshot, null);
        assert.equal(replayAssociation?.frozenRateSnapshot, null);
        const replayCloseAudits = await database
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.action, "pay_sheet_closed"),
              eq(auditEvents.entityId, producerClose.nextSheetId),
            ),
          );
        assert.equal(replayCloseAudits.length, 0);
        assert.deepEqual(
          await database
            .select()
            .from(paySheets)
            .where(
              and(
                eq(paySheets.ownerUserId, references.producerUserId),
                eq(paySheets.ownerType, "producer"),
                eq(paySheets.periodMonth, 8),
                eq(paySheets.periodYear, 2026),
              ),
            ),
          [],
        );

        const serializedLogs = JSON.stringify(loggedEvents);
        for (const forbidden of [
          "150.00",
          "37.50",
          "SINGLE-SETTLEMENT",
        ]) {
          assert.equal(serializedLogs.includes(forbidden), false);
        }
      } finally {
        await pool.end();
      }
    },
  );
});
