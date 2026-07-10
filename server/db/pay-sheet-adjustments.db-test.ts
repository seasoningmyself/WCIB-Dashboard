import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { PaySheetAdjustmentInput } from "../pay-sheets/adjustments.js";
import {
  createPaySheetAdjustment,
  deletePaySheetAdjustment,
  updatePaySheetAdjustment,
} from "../pay-sheets/adjustments.js";
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
  paySheetAdjustments,
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

function adjustmentInput(
  paySheetId: string,
  overrides: Partial<PaySheetAdjustmentInput> = {},
): PaySheetAdjustmentInput {
  return {
    accountBasis: "own",
    adjustmentType: "manual_adjustment",
    brokerFeeDelta: "-1.00",
    commissionDelta: "0.00",
    effectiveDate: "2026-06-15",
    incomeAmount: "0.00",
    insuredOrClientLabel: "Adjustment client",
    paySheetId,
    payoutDelta: "0.00",
    policyTypeId: null,
    producerUserId: null,
    reasonOrNote: null,
    ...overrides,
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

test("adjustments are typed, audited, open-only, and frozen into close totals", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for adjustment DB test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_stone68_adjust",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 2 });
      const database = drizzle(pool, { schema: databaseSchema });
      const loggedEvents: LoggedEvent[] = [];
      const logger = capturingLogger(loggedEvents);

      try {
        const references = await createPolicyReferenceFixture(database);
        const admin = await createUser(database, {
          email: `adjustment-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const adminContext = context(admin.id);
        const createdAt = new Date(Date.now() - 60_000);
        const [sophiaSheet, producerSheet] = await database
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
        assert.ok(sophiaSheet);
        assert.ok(producerSheet);
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
              policyNumber: "ADJUSTMENT-POLICY",
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

        await assert.rejects(
          createPaySheetAdjustment(
            database,
            context(references.submittedByUserId, []),
            adjustmentInput(sophiaSheet.id),
            logger,
          ),
          /authorized lifecycle access is required/i,
        );
        await expectDatabaseError("55000", () =>
          database.insert(paySheetAdjustments).values({
            accountBasis: "own",
            adjustmentType: "manual_adjustment",
            brokerFeeDelta: "-1.00",
            commissionDelta: "0.00",
            createdByUserId: admin.id,
            effectiveDate: "2026-06-15",
            incomeAmount: "0.00",
            insuredOrClientLabel: "Direct write",
            paySheetId: sophiaSheet.id,
            payoutDelta: "0.00",
          }),
        );

        const ownChargebackInput = adjustmentInput(sophiaSheet.id, {
          adjustmentType: "chargeback",
          brokerFeeDelta: "-10.00",
          commissionDelta: "-20.00",
          insuredOrClientLabel: "  Private chargeback client  ",
          policyTypeId: references.policyTypeId,
          reasonOrNote: "  private chargeback note  ",
        });
        const ownChargebackId = await createPaySheetAdjustment(
          database,
          adminContext,
          ownChargebackInput,
          logger,
        );
        const bookAdjustmentId = await createPaySheetAdjustment(
          database,
          adminContext,
          adjustmentInput(sophiaSheet.id, {
            accountBasis: "book",
            adjustmentType: "manual_adjustment",
            brokerFeeDelta: "-4.00",
            commissionDelta: "-6.00",
            insuredOrClientLabel: "Private book correction",
            policyTypeId: references.policyTypeId,
            producerUserId: references.producerUserId,
          }),
          logger,
        );
        const directDepositId = await createPaySheetAdjustment(
          database,
          adminContext,
          adjustmentInput(sophiaSheet.id, {
            adjustmentType: "direct_deposit",
            brokerFeeDelta: "0.00",
            incomeAmount: "100.00",
            insuredOrClientLabel: "Private direct deposit client",
          }),
          logger,
        );
        const checkIncomeId = await createPaySheetAdjustment(
          database,
          adminContext,
          adjustmentInput(sophiaSheet.id, {
            adjustmentType: "check_income",
            brokerFeeDelta: "0.00",
            incomeAmount: "50.00",
            insuredOrClientLabel: "Private check client",
          }),
          logger,
        );
        const achIncomeId = await createPaySheetAdjustment(
          database,
          adminContext,
          adjustmentInput(sophiaSheet.id, {
            adjustmentType: "ach_income",
            brokerFeeDelta: "0.00",
            incomeAmount: "25.00",
            insuredOrClientLabel: "Private ACH client",
          }),
          logger,
        );
        const producerChargebackId = await createPaySheetAdjustment(
          database,
          adminContext,
          adjustmentInput(producerSheet.id, {
            accountBasis: "book",
            adjustmentType: "chargeback",
            brokerFeeDelta: "0.00",
            insuredOrClientLabel: "Private producer clawback",
            payoutDelta: "-5.00",
            policyTypeId: references.policyTypeId,
            producerUserId: references.producerUserId,
          }),
          logger,
        );
        const temporaryAdjustmentId = await createPaySheetAdjustment(
          database,
          adminContext,
          adjustmentInput(sophiaSheet.id, {
            insuredOrClientLabel: "Temporary correction",
          }),
          logger,
        );
        await deletePaySheetAdjustment(
          database,
          adminContext,
          temporaryAdjustmentId,
          logger,
          new Date(Date.now() + 1_000),
        );

        await updatePaySheetAdjustment(
          database,
          adminContext,
          ownChargebackId,
          {
            ...ownChargebackInput,
            brokerFeeDelta: "-12.00",
            commissionDelta: "-18.00",
          },
          logger,
          new Date(Date.now() + 1_000),
        );
        const [normalizedChargeback] = await database
          .select()
          .from(paySheetAdjustments)
          .where(eq(paySheetAdjustments.id, ownChargebackId));
        assert.equal(
          normalizedChargeback?.insuredOrClientLabel,
          "Private chargeback client",
        );
        assert.equal(normalizedChargeback?.reasonOrNote, "private chargeback note");

        for (const invalidInput of [
          adjustmentInput(sophiaSheet.id, {
            brokerFeeDelta: "1.00",
            insuredOrClientLabel: "Positive correction",
          }),
          adjustmentInput(sophiaSheet.id, {
            brokerFeeDelta: "0.00",
            insuredOrClientLabel: "Zero correction",
          }),
          adjustmentInput(sophiaSheet.id, {
            adjustmentType: "direct_deposit",
            brokerFeeDelta: "0.00",
            incomeAmount: "-1.00",
            insuredOrClientLabel: "Negative income",
          }),
          adjustmentInput(sophiaSheet.id, {
            accountBasis: "book",
            brokerFeeDelta: "-1.00",
            insuredOrClientLabel: "Missing producer",
          }),
          adjustmentInput(sophiaSheet.id, {
            adjustmentType: "check_income",
            brokerFeeDelta: "0.00",
            incomeAmount: "1.00",
            insuredOrClientLabel: "Income with policy type",
            policyTypeId: references.policyTypeId,
          }),
          adjustmentInput(sophiaSheet.id, {
            brokerFeeDelta: "-1.00",
            insuredOrClientLabel: "Sophia payout misuse",
            payoutDelta: "-1.00",
          }),
          adjustmentInput(producerSheet.id, {
            adjustmentType: "ach_income",
            brokerFeeDelta: "0.00",
            incomeAmount: "1.00",
            insuredOrClientLabel: "Producer direct income",
          }),
          adjustmentInput(producerSheet.id, {
            brokerFeeDelta: "-1.00",
            insuredOrClientLabel: "Producer broker misuse",
          }),
        ]) {
          await expectDatabaseError("23514", () =>
            createPaySheetAdjustment(
              database,
              adminContext,
              invalidInput,
              logger,
            ),
          );
        }

        await pool.query(`
          CREATE FUNCTION fail_adjustment_audit_for_test()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF NEW.action IN (
              'pay_sheet_adjustment_created',
              'pay_sheet_adjustment_updated',
              'pay_sheet_adjustment_deleted'
            ) THEN
              RAISE EXCEPTION 'forced adjustment audit failure' USING ERRCODE = '55000';
            END IF;
            RETURN NEW;
          END;
          $$
        `);
        await pool.query(`
          CREATE TRIGGER fail_adjustment_audit_for_test_trigger
          BEFORE INSERT ON audit_events
          FOR EACH ROW
          EXECUTE FUNCTION fail_adjustment_audit_for_test()
        `);
        await expectDatabaseError("55000", () =>
          createPaySheetAdjustment(
            database,
            adminContext,
            adjustmentInput(sophiaSheet.id, {
              insuredOrClientLabel: "Must roll back",
            }),
            logger,
          ),
        );
        const [bookBeforeAuditFailure] = await database
          .select()
          .from(paySheetAdjustments)
          .where(eq(paySheetAdjustments.id, bookAdjustmentId));
        assert.ok(bookBeforeAuditFailure);
        await expectDatabaseError("55000", () =>
          updatePaySheetAdjustment(
            database,
            adminContext,
            bookAdjustmentId,
            adjustmentInput(sophiaSheet.id, {
              accountBasis: "book",
              adjustmentType: "manual_adjustment",
              brokerFeeDelta: "-5.00",
              commissionDelta: "-5.00",
              insuredOrClientLabel: "Must not update",
              policyTypeId: references.policyTypeId,
              producerUserId: references.producerUserId,
            }),
            logger,
            new Date(Date.now() + 2_000),
          ),
        );
        await expectDatabaseError("55000", () =>
          deletePaySheetAdjustment(
            database,
            adminContext,
            achIncomeId,
            logger,
            new Date(Date.now() + 2_000),
          ),
        );
        await pool.query(
          "DROP TRIGGER fail_adjustment_audit_for_test_trigger ON audit_events",
        );
        await pool.query("DROP FUNCTION fail_adjustment_audit_for_test() ");
        assert.deepEqual(
          await database
            .select()
            .from(paySheetAdjustments)
            .where(eq(paySheetAdjustments.insuredOrClientLabel, "Must roll back")),
          [],
        );
        const [bookAfterAuditFailure] = await database
          .select()
          .from(paySheetAdjustments)
          .where(eq(paySheetAdjustments.id, bookAdjustmentId));
        const [achAfterAuditFailure] = await database
          .select()
          .from(paySheetAdjustments)
          .where(eq(paySheetAdjustments.id, achIncomeId));
        assert.deepEqual(bookAfterAuditFailure, bookBeforeAuditFailure);
        assert.ok(achAfterAuditFailure);

        const adjustmentRowsBeforeClose = await database
          .select()
          .from(paySheetAdjustments);
        assert.equal(adjustmentRowsBeforeClose.length, 6);
        assert.deepEqual(
          new Set(adjustmentRowsBeforeClose.map((row) => row.adjustmentType)),
          new Set([
            "chargeback",
            "manual_adjustment",
            "direct_deposit",
            "check_income",
            "ach_income",
          ]),
        );

        const producerClose = await closePaySheet(
          database,
          adminContext,
          producerSheet.id,
          logger,
        );
        const sophiaClose = await closePaySheet(
          database,
          adminContext,
          sophiaSheet.id,
          logger,
        );
        const [closedProducer] = await database
          .select()
          .from(paySheets)
          .where(eq(paySheets.id, producerSheet.id));
        const [closedSophia] = await database
          .select()
          .from(paySheets)
          .where(eq(paySheets.id, sophiaSheet.id));
        assert.deepEqual(closedProducer?.frozenTotals, {
          brokerFees: "50.00",
          commissions: "100.00",
          directCheckAchIncome: "0.00",
          grandTotalIncome: "150.00",
          producerPayout: "32.50",
          trustPull: "150.00",
        });
        assert.deepEqual(closedSophia?.frozenTotals, {
          brokerFees: "34.00",
          commissions: "76.00",
          directCheckAchIncome: "175.00",
          grandTotalIncome: "285.00",
          sophiaAgencyGross: "285.00",
          sophiaShare: "75.00",
          sophiaTakeHome: "250.00",
          trustPull: "110.00",
        });

        const closedPolicyAssociations = await database
          .select()
          .from(paySheetPolicies)
          .where(eq(paySheetPolicies.policyId, policy.id));
        assert.equal(closedPolicyAssociations.length, 2);
        assert.equal(
          closedPolicyAssociations.every(
            (association) =>
              JSON.stringify(association.frozenPolicySnapshot).includes(
                ownChargebackId,
              ) === false,
          ),
          true,
        );

        await expectDatabaseError("55000", () =>
          updatePaySheetAdjustment(
            database,
            adminContext,
            ownChargebackId,
            {
              ...ownChargebackInput,
              brokerFeeDelta: "-13.00",
              commissionDelta: "-17.00",
            },
            logger,
          ),
        );
        await expectDatabaseError("55000", () =>
          deletePaySheetAdjustment(
            database,
            adminContext,
            producerChargebackId,
            logger,
          ),
        );
        await expectDatabaseError("55000", () =>
          createPaySheetAdjustment(
            database,
            adminContext,
            adjustmentInput(sophiaSheet.id, {
              insuredOrClientLabel: "Closed sheet correction",
            }),
            logger,
          ),
        );

        const nextOpenAdjustmentId = await createPaySheetAdjustment(
          database,
          adminContext,
          adjustmentInput(sophiaClose.nextSheetId, {
            insuredOrClientLabel: "Next open correction",
          }),
          logger,
        );
        assert.match(nextOpenAdjustmentId, /^[0-9a-f-]{36}$/);
        const [nextOpenAdjustment] = await database
          .select()
          .from(paySheetAdjustments)
          .where(eq(paySheetAdjustments.id, nextOpenAdjustmentId));
        assert.equal(nextOpenAdjustment?.paySheetId, sophiaClose.nextSheetId);
        assert.notEqual(nextOpenAdjustment?.paySheetId, producerClose.nextSheetId);

        const adjustmentAudits = await database
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.entityType, "pay_sheet_adjustment"));
        assert.equal(
          adjustmentAudits.some(
            (audit) =>
              audit.action === "pay_sheet_adjustment_created" &&
              audit.entityId === directDepositId,
          ),
          true,
        );
        assert.equal(
          adjustmentAudits.some(
            (audit) =>
              audit.action === "pay_sheet_adjustment_updated" &&
              audit.entityId === ownChargebackId,
          ),
          true,
        );
        assert.equal(
          adjustmentAudits.some(
            (audit) =>
              audit.action === "pay_sheet_adjustment_deleted" &&
              audit.entityId === temporaryAdjustmentId,
          ),
          true,
        );
        assert.equal(
          adjustmentAudits.some((audit) =>
            JSON.stringify([audit.beforeSummary, audit.afterSummary]).match(
              /Private|100\.00|50\.00|25\.00/,
            ),
          ),
          false,
        );

        assert.equal(typeof bookAdjustmentId, "string");
        assert.equal(typeof checkIncomeId, "string");
        assert.equal(typeof achIncomeId, "string");
        const serializedLogs = JSON.stringify(loggedEvents);
        for (const forbidden of [
          "Private chargeback client",
          "private chargeback note",
          "Private book correction",
          "Private direct deposit client",
          "Private check client",
          "Private ACH client",
          "100.00",
          "50.00",
          "25.00",
        ]) {
          assert.equal(serializedLogs.includes(forbidden), false);
        }
      } finally {
        await pool.end();
      }
    },
  );
});
