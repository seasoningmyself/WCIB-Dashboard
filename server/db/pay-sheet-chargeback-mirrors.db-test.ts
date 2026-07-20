import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import {
  createPaySheetAdjustment,
  deletePaySheetAdjustment,
  updatePaySheetAdjustment,
} from "../pay-sheets/adjustments.js";
import { closePaySheetWithCascade } from "../pay-sheets/close.js";
import { syncMgaPaymentSheetPlacement } from "../pay-sheets/mga-placement.js";
import { setMgaPaymentState } from "../policies/mga-payments.js";
import { withDisposableMigratedDatabase } from "./disposable-database-test-helper.js";
import { readDatabaseErrorCode } from "./error-code.js";
import {
  auditEvents,
  paySheetAdjustments,
  paySheets,
  policies,
  producerRateHistory,
  staffProfiles,
  userCapabilities,
} from "./schema.js";
import * as databaseSchema from "./schema.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "./policy-test-fixture.js";

const logger: AppLogger = {
  error() {},
  info() {},
  warn() {},
};

test("Sophia chargebacks normalize and mirror producer impact atomically", async () => {
  const sourceUrl = process.env.DATABASE_URL;
  assert.ok(sourceUrl, "DATABASE_URL is required for chargeback mirror DB test");

  await withDisposableMigratedDatabase(
    sourceUrl,
    "wcib_k5_mirror",
    async (databaseUrl) => {
      const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const fixture = await createPolicyReferenceFixture(database);
        const admin = await createUser(database, {
          email: `chargeback-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const adminContext = context(admin.id);
        const openedAt = new Date("2026-06-01T12:00:00.000Z");
        const [sophiaSheet] = await database
          .insert(paySheets)
          .values({
            createdAt: openedAt,
            openedAt,
            ownerType: "sophia",
            ownerUserId: admin.id,
            periodMonth: 6,
            periodYear: 2026,
            updatedAt: openedAt,
          })
          .returning();
        assert.ok(sophiaSheet);
        await database.insert(producerRateHistory).values({
          effectiveDate: "2026-01-01",
          newBrokerRate: "40.00",
          newCommissionRate: "30.00",
          producerUserId: fixture.producerUserId,
          renewalBrokerRate: "25.00",
          renewalCommissionRate: "25.00",
        });

        const createdAt = new Date("2026-06-15T15:00:00.000Z");
        const sourceId = await createPaySheetAdjustment(
          database,
          adminContext,
          chargeback(sophiaSheet.id, fixture.producerUserId, {
            brokerFeeDelta: "10.00",
            commissionDelta: "87.50",
          }),
          logger,
          createdAt,
        );
        const [source] = await database
          .select()
          .from(paySheetAdjustments)
          .where(eq(paySheetAdjustments.id, sourceId));
        const [mirror] = await database
          .select()
          .from(paySheetAdjustments)
          .where(eq(paySheetAdjustments.sourceAdjustmentId, sourceId));
        assert.ok(source);
        assert.ok(mirror);
        assert.equal(source.brokerFeeDelta, "-10.00");
        assert.equal(source.commissionDelta, "-87.50");
        assert.equal(source.sourceAdjustmentId, null);
        assert.equal(mirror.payoutDelta, "-24.38");
        assert.equal(mirror.producerUserId, fixture.producerUserId);
        assert.equal(mirror.accountBasis, "book");
        const [producerSheet] = await database
          .select()
          .from(paySheets)
          .where(
            and(
              eq(paySheets.ownerType, "producer"),
              eq(paySheets.ownerUserId, fixture.producerUserId),
              eq(paySheets.status, "open"),
            ),
          );
        assert.ok(producerSheet);
        assert.equal(producerSheet.id, mirror.paySheetId);
        assert.deepEqual(
          [producerSheet.periodMonth, producerSheet.periodYear],
          [6, 2026],
        );
        await assertAuditCount(database, sourceId, "pay_sheet_adjustment_created", 1);
        await assertAuditCount(database, mirror.id, "pay_sheet_adjustment_created", 1);

        await expectDatabaseError("P0002", () =>
          updatePaySheetAdjustment(
            database,
            adminContext,
            mirror.id,
            chargeback(producerSheet.id, fixture.producerUserId, {
              brokerFeeDelta: "0.00",
              payoutDelta: "1.00",
            }),
            logger,
          ),
        );
        await expectDatabaseError("55000", () =>
          database
            .update(paySheetAdjustments)
            .set({ payoutDelta: "-99.00" })
            .where(eq(paySheetAdjustments.id, mirror.id)),
        );

        const updatedAt = new Date("2026-06-16T15:00:00.000Z");
        await updatePaySheetAdjustment(
          database,
          adminContext,
          sourceId,
          chargeback(sophiaSheet.id, fixture.producerUserId, {
            brokerFeeDelta: "20.00",
            commissionDelta: "80.00",
          }),
          logger,
          updatedAt,
        );
        const [updatedSource] = await database
          .select()
          .from(paySheetAdjustments)
          .where(eq(paySheetAdjustments.id, sourceId));
        const [updatedMirror] = await database
          .select()
          .from(paySheetAdjustments)
          .where(eq(paySheetAdjustments.sourceAdjustmentId, sourceId));
        assert.equal(updatedSource?.brokerFeeDelta, "-20.00");
        assert.equal(updatedSource?.commissionDelta, "-80.00");
        assert.equal(updatedMirror?.payoutDelta, "-25.00");
        await assertAuditCount(database, sourceId, "pay_sheet_adjustment_updated", 1);
        await assertAuditCount(database, mirror.id, "pay_sheet_adjustment_updated", 1);

        const disposableSourceId = await createPaySheetAdjustment(
          database,
          adminContext,
          chargeback(sophiaSheet.id, fixture.producerUserId, {
            brokerFeeDelta: "4.00",
            commissionDelta: "6.00",
            insuredOrClientLabel: "Deleted mirrored chargeback",
          }),
          logger,
          new Date("2026-06-17T15:00:00.000Z"),
        );
        const [disposableMirror] = await database
          .select()
          .from(paySheetAdjustments)
          .where(eq(paySheetAdjustments.sourceAdjustmentId, disposableSourceId));
        assert.ok(disposableMirror);
        await deletePaySheetAdjustment(
          database,
          adminContext,
          disposableSourceId,
          logger,
          new Date("2026-06-18T15:00:00.000Z"),
        );
        assert.deepEqual(
          await database
            .select()
            .from(paySheetAdjustments)
            .where(eq(paySheetAdjustments.id, disposableSourceId)),
          [],
        );
        assert.deepEqual(
          await database
            .select()
            .from(paySheetAdjustments)
            .where(eq(paySheetAdjustments.id, disposableMirror.id)),
          [],
        );
        await assertAuditCount(
          database,
          disposableSourceId,
          "pay_sheet_adjustment_deleted",
          1,
        );
        await assertAuditCount(
          database,
          disposableMirror.id,
          "pay_sheet_adjustment_deleted",
          1,
        );

        const rollbackProducer = await createUser(database, {
          displayName: "Rollback Producer",
          email: `chargeback-producer-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(staffProfiles).values({
          role: "producer",
          userId: rollbackProducer.id,
        });
        await database.insert(producerRateHistory).values({
          effectiveDate: "2026-01-01",
          newBrokerRate: "25.00",
          newCommissionRate: "25.00",
          producerUserId: rollbackProducer.id,
          renewalBrokerRate: "25.00",
          renewalCommissionRate: "25.00",
        });
        await pool.query(`
          CREATE FUNCTION fail_second_adjustment_audit_for_test()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF NEW.action = 'pay_sheet_adjustment_created'
              AND EXISTS (
                SELECT 1
                FROM audit_events
                WHERE action = 'pay_sheet_adjustment_created'
                  AND actor_user_id = NEW.actor_user_id
                  AND occurred_at = NEW.occurred_at
              ) THEN
              RAISE EXCEPTION 'forced mirror audit failure' USING ERRCODE = '55000';
            END IF;
            RETURN NEW;
          END;
          $$
        `);
        await pool.query(`
          CREATE TRIGGER fail_second_adjustment_audit_for_test_trigger
          BEFORE INSERT ON audit_events
          FOR EACH ROW
          EXECUTE FUNCTION fail_second_adjustment_audit_for_test()
        `);
        const rollbackAt = new Date("2026-06-19T15:00:00.000Z");
        await expectDatabaseError("55000", () =>
          createPaySheetAdjustment(
            database,
            adminContext,
            chargeback(sophiaSheet.id, rollbackProducer.id, {
              brokerFeeDelta: "5.00",
              commissionDelta: "5.00",
              insuredOrClientLabel: "Must fully roll back",
            }),
            logger,
            rollbackAt,
          ),
        );
        await pool.query(
          "DROP TRIGGER fail_second_adjustment_audit_for_test_trigger ON audit_events",
        );
        await pool.query("DROP FUNCTION fail_second_adjustment_audit_for_test() ");
        assert.deepEqual(
          await database
            .select()
            .from(paySheetAdjustments)
            .where(eq(paySheetAdjustments.insuredOrClientLabel, "Must fully roll back")),
          [],
        );
        assert.deepEqual(
          await database
            .select()
            .from(paySheets)
            .where(eq(paySheets.ownerUserId, rollbackProducer.id)),
          [],
        );
        assert.deepEqual(
          await database
            .select()
            .from(auditEvents)
            .where(eq(auditEvents.occurredAt, rollbackAt)),
          [],
        );

        const policyCreatedAt = new Date("2026-06-20T15:00:00.000Z");
        const [policy] = await database
          .insert(policies)
          .values(
            policyTestInput(fixture, {
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
              policyNumber: "K5-CLOSE-POLICY",
              producerUserId: fixture.producerUserId,
              proposalTotal: "1050.00",
              sourceDraftId: null,
              updatedAt: policyCreatedAt,
            }),
          )
          .returning();
        assert.ok(policy);
        const paidAt = new Date("2026-06-21T15:00:00.000Z");
        await setMgaPaymentState(
          database,
          adminContext,
          policy.id,
          "paid",
          null,
          logger,
          paidAt,
        );
        await syncMgaPaymentSheetPlacement(
          database,
          adminContext,
          policy.id,
          true,
          logger,
          paidAt,
        );

        const closeResult = await closePaySheetWithCascade(
          database,
          adminContext,
          sophiaSheet.id,
          true,
          logger,
        );
        assert.equal(closeResult.cascaded.length, 1);
        const [closedSophia] = await database
          .select()
          .from(paySheets)
          .where(eq(paySheets.id, sophiaSheet.id));
        const [closedProducer] = await database
          .select()
          .from(paySheets)
          .where(eq(paySheets.id, producerSheet.id));
        assert.equal(closedSophia?.status, "closed");
        assert.equal(closedProducer?.status, "closed");
        const frozenBefore = JSON.stringify({
          producer: closedProducer?.frozenTotals,
          sophia: closedSophia?.frozenTotals,
        });
        await expectDatabaseError("55000", () =>
          updatePaySheetAdjustment(
            database,
            adminContext,
            sourceId,
            chargeback(sophiaSheet.id, fixture.producerUserId, {
              brokerFeeDelta: "50.00",
              commissionDelta: "50.00",
            }),
            logger,
          ),
        );
        const [closedSophiaAfter] = await database
          .select()
          .from(paySheets)
          .where(eq(paySheets.id, sophiaSheet.id));
        const [closedProducerAfter] = await database
          .select()
          .from(paySheets)
          .where(eq(paySheets.id, producerSheet.id));
        assert.equal(
          JSON.stringify({
            producer: closedProducerAfter?.frozenTotals,
            sophia: closedSophiaAfter?.frozenTotals,
          }),
          frozenBefore,
        );
      } finally {
        await pool.end();
      }
    },
  );
});

function chargeback(
  paySheetId: string,
  producerUserId: string,
  overrides: Partial<Parameters<typeof createPaySheetAdjustment>[2]> = {},
): Parameters<typeof createPaySheetAdjustment>[2] {
  return {
    accountBasis: "book",
    adjustmentType: "chargeback",
    brokerFeeDelta: "10.00",
    commissionDelta: "0.00",
    effectiveDate: "2026-06-15",
    incomeAmount: "0.00",
    insuredOrClientLabel: "Mirrored chargeback",
    paySheetId,
    payoutDelta: "0.00",
    policyTypeId: null,
    producerUserId,
    reasonOrNote: "Carrier reversal",
    ...overrides,
  };
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

async function expectDatabaseError(
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  await assert.rejects(
    action,
    (error: unknown) => readDatabaseErrorCode(error) === code,
  );
}

async function assertAuditCount(
  database: ReturnType<typeof drizzle<typeof databaseSchema>>,
  entityId: string,
  action: typeof auditEvents.$inferSelect.action,
  expected: number,
): Promise<void> {
  const rows = await database
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.entityId, entityId),
        eq(auditEvents.action, action),
      ),
    );
  assert.equal(rows.length, expected);
}
