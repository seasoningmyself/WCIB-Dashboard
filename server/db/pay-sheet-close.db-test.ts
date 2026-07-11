import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  PAY_SHEET_POLICY_SNAPSHOT_FIELDS,
  PAY_SHEET_RATE_SNAPSHOT_FIELDS,
} from "../../shared/pay-sheet-snapshots.js";
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

function context(
  userId: string,
  capabilities: AuthorizedRequestContext["principal"]["capabilities"] = [
    "admin",
  ],
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

async function expectDatabaseError(
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  await assert.rejects(
    action,
    (error: unknown) => readDatabaseErrorCode(error) === code,
  );
}

test("pay-sheet close freezes financial history and advances each owner atomically", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for pay-sheet close DB test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_stone65_close",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 4 });
      const database = drizzle(pool, { schema: databaseSchema });
      const loggedEvents: LoggedEvent[] = [];
      const logger = capturingLogger(loggedEvents);

      try {
        const references = await createPolicyReferenceFixture(database);
        const admin = await createUser(database, {
          email: `pay-sheet-close-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const adminContext = context(admin.id);
        const createdAt = new Date(Date.now() - 60_000);
        const [sophiaJuly, producerJuly] = await database
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
        assert.ok(sophiaJuly);
        assert.ok(producerJuly);

        const closeDate = new Date().toISOString().slice(0, 10);
        const [oldRate, activeRate] = await database
          .insert(producerRateHistory)
          .values([
            {
              effectiveDate: "2000-01-01",
              newBrokerRate: "10.00",
              newCommissionRate: "10.00",
              producerUserId: references.producerUserId,
              renewalBrokerRate: "10.00",
              renewalCommissionRate: "10.00",
            },
            {
              effectiveDate: closeDate,
              newBrokerRate: "50.00",
              newCommissionRate: "25.00",
              producerUserId: references.producerUserId,
              renewalBrokerRate: "30.00",
              renewalCommissionRate: "20.00",
            },
          ])
          .returning();
        assert.ok(oldRate);
        assert.ok(activeRate);

        const policyCreatedAt = new Date(Date.now() - 30_000);
        const [assignedPolicy, ownPolicy] = await database
          .insert(policies)
          .values([
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
              policyNumber: "CLOSE-ASSIGNED",
              producerUserId: references.producerUserId,
              proposalTotal: "1050.00",
              sourceDraftId: null,
              transactionType: "New",
              updatedAt: policyCreatedAt,
            }),
            policyTestInput(references, {
              amountPaid: "2000.00",
              basePremium: "2000.00",
              brokerFee: "100.00",
              commissionAmount: "200.00",
              commissionConfirmed: true,
              commissionMode: "pct",
              commissionRate: "10.0000",
              createdAt: policyCreatedAt,
              financeBalance: "0.00",
              kayleeSplit: "none",
              netDue: "1700.00",
              paymentMode: "full",
              policyNumber: "CLOSE-OWN",
              producerUserId: null,
              proposalTotal: "2100.00",
              sourceDraftId: null,
              transactionType: "Renewal",
              updatedAt: policyCreatedAt,
            }),
          ])
          .returning();
        assert.ok(assignedPolicy);
        assert.ok(ownPolicy);

        for (const policy of [assignedPolicy, ownPolicy]) {
          const changedAt = new Date();
          await setMgaPaymentState(
            database,
            adminContext,
            policy.id,
            "paid",
            null,
            logger,
            changedAt,
          );
          await syncMgaPaymentSheetPlacement(
            database,
            adminContext,
            policy.id,
            true,
            logger,
            changedAt,
          );
        }

        await assert.rejects(
          closePaySheet(
            database,
            context(references.submittedByUserId, []),
            producerJuly.id,
            logger,
          ),
          /authorized lifecycle access is required/i,
        );

        await pool.query(`
          CREATE FUNCTION fail_pay_sheet_snapshot_for_test()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            RAISE EXCEPTION 'forced snapshot failure' USING ERRCODE = '55000';
          END;
          $$
        `);
        await pool.query(`
          CREATE TRIGGER fail_pay_sheet_snapshot_for_test_trigger
          BEFORE UPDATE ON pay_sheet_policies
          FOR EACH ROW
          EXECUTE FUNCTION fail_pay_sheet_snapshot_for_test()
        `);
        await expectDatabaseError("55000", () =>
          closePaySheet(database, adminContext, producerJuly.id, logger),
        );
        await pool.query(
          "DROP TRIGGER fail_pay_sheet_snapshot_for_test_trigger ON pay_sheet_policies",
        );
        await pool.query("DROP FUNCTION fail_pay_sheet_snapshot_for_test() ");
        const [afterSnapshotFailure] = await database
          .select()
          .from(paySheets)
          .where(eq(paySheets.id, producerJuly.id));
        assert.equal(afterSnapshotFailure?.status, "open");
        assert.equal(afterSnapshotFailure?.frozenTotals, null);

        await pool.query(`
          CREATE FUNCTION fail_pay_sheet_close_audit_for_test()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF NEW.action = 'pay_sheet_closed' THEN
              RAISE EXCEPTION 'forced close audit failure' USING ERRCODE = '55000';
            END IF;
            RETURN NEW;
          END;
          $$
        `);
        await pool.query(`
          CREATE TRIGGER fail_pay_sheet_close_audit_for_test_trigger
          BEFORE INSERT ON audit_events
          FOR EACH ROW
          EXECUTE FUNCTION fail_pay_sheet_close_audit_for_test()
        `);
        await expectDatabaseError("55000", () =>
          closePaySheet(database, adminContext, producerJuly.id, logger),
        );
        await pool.query(
          "DROP TRIGGER fail_pay_sheet_close_audit_for_test_trigger ON audit_events",
        );
        await pool.query("DROP FUNCTION fail_pay_sheet_close_audit_for_test() ");

        const [rateAfterAuditFailure] = await database
          .select()
          .from(producerRateHistory)
          .where(eq(producerRateHistory.id, activeRate.id));
        const [associationAfterAuditFailure] = await database
          .select()
          .from(paySheetPolicies)
          .where(
            and(
              eq(paySheetPolicies.paySheetId, producerJuly.id),
              eq(paySheetPolicies.policyId, assignedPolicy.id),
            ),
          );
        assert.equal(rateAfterAuditFailure?.lockedAt, null);
        assert.equal(associationAfterAuditFailure?.frozenPolicySnapshot, null);
        assert.equal(associationAfterAuditFailure?.frozenRateSnapshot, null);

        const producerClose = await closePaySheet(
          database,
          adminContext,
          producerJuly.id,
          logger,
        );
        assert.deepEqual(
          {
            closed: producerClose.closed,
            ownerType: producerClose.ownerType,
            periodMonth: producerClose.periodMonth,
            periodYear: producerClose.periodYear,
            policyCount: producerClose.policyCount,
          },
          {
            closed: true,
            ownerType: "producer",
            periodMonth: 7,
            periodYear: 2026,
            policyCount: 1,
          },
        );
        const [closedProducerSheet] = await database
          .select()
          .from(paySheets)
          .where(eq(paySheets.id, producerJuly.id));
        const [producerNextSheet] = await database
          .select()
          .from(paySheets)
          .where(eq(paySheets.id, producerClose.nextSheetId));
        assert.deepEqual(closedProducerSheet?.frozenTotals, {
          brokerFees: "50.00",
          commissions: "100.00",
          directCheckAchIncome: "0.00",
          grandTotalIncome: "150.00",
          producerPayout: "50.00",
          trustPull: "150.00",
        });
        assert.equal(closedProducerSheet?.status, "closed");
        assert.equal(closedProducerSheet?.closedByUserId, admin.id);
        assert.ok(closedProducerSheet?.closedAt);
        assert.deepEqual(
          {
            ownerType: producerNextSheet?.ownerType,
            ownerUserId: producerNextSheet?.ownerUserId,
            periodMonth: producerNextSheet?.periodMonth,
            periodYear: producerNextSheet?.periodYear,
            status: producerNextSheet?.status,
          },
          {
            ownerType: "producer",
            ownerUserId: references.producerUserId,
            periodMonth: 8,
            periodYear: 2026,
            status: "open",
          },
        );

        const [producerAssociation] = await database
          .select()
          .from(paySheetPolicies)
          .where(
            and(
              eq(paySheetPolicies.paySheetId, producerJuly.id),
              eq(paySheetPolicies.policyId, assignedPolicy.id),
            ),
          );
        assert.ok(producerAssociation);
        const producerSnapshot = producerAssociation.frozenPolicySnapshot as Record<
          string,
          unknown
        >;
        assert.deepEqual(
          Object.keys(producerSnapshot).sort(),
          [...PAY_SHEET_POLICY_SNAPSHOT_FIELDS].sort(),
        );
        assert.equal(producerSnapshot.producerPayout, "50.00");
        assert.equal(producerSnapshot.sophiaShare, "112.50");
        assert.equal(producerSnapshot.agencyRevenue, "150.00");
        assert.equal("carrierFee" in producerSnapshot, false);
        assert.equal("rewriteSubtype" in producerSnapshot, false);
        assert.equal(producerAssociation.producerRateHistoryId, activeRate.id);
        assert.deepEqual(
          Object.keys(
            producerAssociation.frozenRateSnapshot as Record<string, unknown>,
          ).sort(),
          [...PAY_SHEET_RATE_SNAPSHOT_FIELDS].sort(),
        );
        assert.deepEqual(producerAssociation.frozenRateSnapshot, {
          effectiveDate: closeDate,
          newBrokerRate: "50.00",
          newCommissionRate: "25.00",
          renewalBrokerRate: "30.00",
          renewalCommissionRate: "20.00",
        });

        const [lockedActiveRate] = await database
          .select()
          .from(producerRateHistory)
          .where(eq(producerRateHistory.id, activeRate.id));
        const [unlockedOldRate] = await database
          .select()
          .from(producerRateHistory)
          .where(eq(producerRateHistory.id, oldRate.id));
        assert.ok(lockedActiveRate?.lockedAt);
        assert.equal(unlockedOldRate?.lockedAt, null);

        const repeatedProducerClose = await closePaySheet(
          database,
          adminContext,
          producerJuly.id,
          logger,
        );
        assert.equal(repeatedProducerClose.closed, false);
        assert.equal(
          repeatedProducerClose.nextSheetId,
          producerClose.nextSheetId,
        );
        const producerCloseAudits = await database
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.action, "pay_sheet_closed"),
              eq(auditEvents.entityId, producerJuly.id),
            ),
          );
        assert.equal(producerCloseAudits.length, 1);

        const sophiaClose = await closePaySheet(
          database,
          adminContext,
          sophiaJuly.id,
          logger,
        );
        const [closedSophiaSheet] = await database
          .select()
          .from(paySheets)
          .where(eq(paySheets.id, sophiaJuly.id));
        assert.deepEqual(closedSophiaSheet?.frozenTotals, {
          brokerFees: "150.00",
          commissions: "300.00",
          directCheckAchIncome: "0.00",
          grandTotalIncome: "450.00",
          sophiaAgencyGross: "450.00",
          sophiaShare: "412.50",
          sophiaTakeHome: "412.50",
          trustPull: "450.00",
        });
        assert.equal(sophiaClose.policyCount, 2);
        const sophiaAssociations = await database
          .select()
          .from(paySheetPolicies)
          .where(eq(paySheetPolicies.paySheetId, sophiaJuly.id));
        assert.equal(sophiaAssociations.length, 2);
        assert.equal(
          sophiaAssociations.every(
            (association) =>
              association.producerRateHistoryId === null &&
              association.frozenRateSnapshot === null &&
              (association.frozenPolicySnapshot as Record<string, unknown>)
                .producerPayout === "0.00",
          ),
          true,
        );

        await database
          .update(paySheets)
          .set({
            periodMonth: 12,
            periodYear: 2026,
            updatedAt: new Date(),
          })
          .where(eq(paySheets.id, sophiaClose.nextSheetId));
        const [decemberPolicy] = await database
          .insert(policies)
          .values(
            policyTestInput(references, {
              amountPaid: "100.00",
              basePremium: "100.00",
              brokerFee: "5.00",
              commissionAmount: "10.00",
              commissionConfirmed: true,
              commissionMode: "pct",
              commissionRate: "10.0000",
              createdAt: policyCreatedAt,
              financeBalance: "0.00",
              kayleeSplit: "none",
              netDue: "85.00",
              paymentMode: "full",
              policyNumber: "CLOSE-DECEMBER",
              producerUserId: null,
              proposalTotal: "105.00",
              sourceDraftId: null,
              updatedAt: policyCreatedAt,
            }),
          )
          .returning();
        assert.ok(decemberPolicy);
        const decemberPaidAt = new Date();
        await setMgaPaymentState(
          database,
          adminContext,
          decemberPolicy.id,
          "paid",
          null,
          logger,
          decemberPaidAt,
        );
        await syncMgaPaymentSheetPlacement(
          database,
          adminContext,
          decemberPolicy.id,
          true,
          logger,
          decemberPaidAt,
        );
        const decemberClose = await closePaySheet(
          database,
          adminContext,
          sophiaClose.nextSheetId,
          logger,
        );
        const [sophiaJanuary] = await database
          .select()
          .from(paySheets)
          .where(eq(paySheets.id, decemberClose.nextSheetId));
        assert.deepEqual(
          {
            periodMonth: sophiaJanuary?.periodMonth,
            periodYear: sophiaJanuary?.periodYear,
            status: sophiaJanuary?.status,
          },
          { periodMonth: 1, periodYear: 2027, status: "open" },
        );

        await database
          .update(paySheets)
          .set({ periodMonth: 1, periodYear: 2027, updatedAt: new Date() })
          .where(eq(paySheets.id, producerClose.nextSheetId));
        const [racePolicy] = await database
          .insert(policies)
          .values(
            policyTestInput(references, {
              amountPaid: "500.00",
              basePremium: "500.00",
              brokerFee: "25.00",
              commissionAmount: "50.00",
              commissionConfirmed: true,
              commissionMode: "pct",
              commissionRate: "10.0000",
              createdAt: policyCreatedAt,
              financeBalance: "0.00",
              kayleeSplit: "book",
              netDue: "425.00",
              paymentMode: "full",
              policyNumber: "CLOSE-RACE",
              producerUserId: references.producerUserId,
              proposalTotal: "525.00",
              sourceDraftId: null,
              transactionType: "Renewal",
              updatedAt: policyCreatedAt,
            }),
          )
          .returning();
        assert.ok(racePolicy);
        const racePaidAt = new Date();
        await setMgaPaymentState(
          database,
          adminContext,
          racePolicy.id,
          "paid",
          null,
          logger,
          racePaidAt,
        );
        await syncMgaPaymentSheetPlacement(
          database,
          adminContext,
          racePolicy.id,
          true,
          logger,
          racePaidAt,
        );

        await pool.query(`
          CREATE FUNCTION slow_pay_sheet_close_for_test()
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
          CREATE TRIGGER slow_pay_sheet_close_for_test_trigger
          BEFORE UPDATE ON pay_sheet_policies
          FOR EACH ROW
          EXECUTE FUNCTION slow_pay_sheet_close_for_test()
        `);
        const [firstClient, secondClient] = await Promise.all([
          pool.connect(),
          pool.connect(),
        ]);
        let concurrentResults;
        try {
          concurrentResults = await Promise.all([
            closePaySheet(
              drizzle(firstClient, { schema: databaseSchema }),
              adminContext,
              producerClose.nextSheetId,
              logger,
            ),
            closePaySheet(
              drizzle(secondClient, { schema: databaseSchema }),
              adminContext,
              producerClose.nextSheetId,
              logger,
            ),
          ]);
        } finally {
          firstClient.release();
          secondClient.release();
        }
        await pool.query(
          "DROP TRIGGER slow_pay_sheet_close_for_test_trigger ON pay_sheet_policies",
        );
        await pool.query("DROP FUNCTION slow_pay_sheet_close_for_test() ");
        assert.deepEqual(
          concurrentResults.map((result) => result.closed).sort(),
          [false, true],
        );
        assert.equal(
          concurrentResults[0]?.nextSheetId,
          concurrentResults[1]?.nextSheetId,
        );
        const producerRaceAudits = await database
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.action, "pay_sheet_closed"),
              eq(auditEvents.entityId, producerClose.nextSheetId),
            ),
          );
        assert.equal(producerRaceAudits.length, 1);
        const producerFebruarySheets = await database
          .select()
          .from(paySheets)
          .where(
            and(
              eq(paySheets.ownerUserId, references.producerUserId),
              eq(paySheets.ownerType, "producer"),
              eq(paySheets.periodMonth, 2),
              eq(paySheets.periodYear, 2027),
            ),
          );
        assert.equal(producerFebruarySheets.length, 1);

        await database.insert(paySheets).values({
          ownerType: "sophia",
          ownerUserId: admin.id,
          periodMonth: 2,
          periodYear: 2027,
          status: "closed",
        });
        await expectDatabaseError("23505", () =>
          closePaySheet(database, adminContext, sophiaJanuary!.id, logger),
        );
        const [sophiaAfterNextFailure] = await database
          .select()
          .from(paySheets)
          .where(eq(paySheets.id, sophiaJanuary!.id));
        const [sophiaRaceAssociation] = await database
          .select()
          .from(paySheetPolicies)
          .where(
            and(
              eq(paySheetPolicies.paySheetId, sophiaJanuary!.id),
              eq(paySheetPolicies.policyId, racePolicy.id),
            ),
          );
        assert.equal(sophiaAfterNextFailure?.status, "open");
        assert.equal(sophiaAfterNextFailure?.frozenTotals, null);
        assert.equal(sophiaRaceAssociation?.frozenPolicySnapshot, null);
        const failedSophiaCloseAudits = await database
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.action, "pay_sheet_closed"),
              eq(auditEvents.entityId, sophiaJanuary!.id),
            ),
          );
        assert.equal(failedSophiaCloseAudits.length, 0);

        await expectDatabaseError("23514", () =>
          closePaySheet(
            database,
            adminContext,
            producerFebruarySheets[0]!.id,
            logger,
          ),
        );

        const serializedLogs = JSON.stringify(loggedEvents);
        for (const forbidden of [
          "450.00",
          "412.50",
          "CLOSE-ASSIGNED",
          "CLOSE-OWN",
          "CLOSE-RACE",
        ]) {
          assert.equal(serializedLogs.includes(forbidden), false);
        }
        assert.equal(
          loggedEvents.some(
            (event) => event.context.event === "pay_sheet_close_succeeded",
          ),
          true,
        );
        assert.equal(
          loggedEvents.some(
            (event) => event.context.event === "pay_sheet_close_failed",
          ),
          true,
        );
      } finally {
        await pool.end();
      }
    },
  );
});
