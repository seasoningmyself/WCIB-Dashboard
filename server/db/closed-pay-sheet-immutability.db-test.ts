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

async function expectDatabaseError(
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  await assert.rejects(
    action,
    (error: unknown) => readDatabaseErrorCode(error) === code,
  );
}

test("closed sheets freeze protected fields while open MGA placement remains usable", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(
    databaseUrl,
    "DATABASE_URL is required for closed pay-sheet integrity DB test",
  );

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_stone66_closed",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 1 });
      const database = drizzle(pool, { schema: databaseSchema });
      const loggedEvents: LoggedEvent[] = [];
      const logger = capturingLogger(loggedEvents);

      try {
        const references = await createPolicyReferenceFixture(database);
        const admin = await createUser(database, {
          email: `closed-sheet-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const context = adminContext(admin.id);
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
        const [settledPolicy, openPolicy] = await database
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
              policyNumber: "IMMUTABLE-CLOSED",
              producerUserId: references.producerUserId,
              proposalTotal: "1050.00",
              sourceDraftId: null,
              updatedAt: policyCreatedAt,
            }),
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
              policyNumber: "IMMUTABLE-OPEN",
              producerUserId: references.producerUserId,
              proposalTotal: "525.00",
              sourceDraftId: null,
              updatedAt: policyCreatedAt,
            }),
          ])
          .returning();
        assert.ok(settledPolicy);
        assert.ok(openPolicy);

        const settledAt = new Date();
        await setMgaPaymentState(
          database,
          context,
          settledPolicy.id,
          "paid",
          null,
          logger,
          settledAt,
        );
        await syncMgaPaymentSheetPlacement(
          database,
          context,
          settledPolicy.id,
          true,
          logger,
          settledAt,
        );
        const producerClose = await closePaySheet(
          database,
          context,
          producerSheet.id,
          logger,
        );
        const sophiaClose = await closePaySheet(
          database,
          context,
          sophiaSheet.id,
          logger,
        );

        const [closedProducerBefore] = await database
          .select()
          .from(paySheets)
          .where(eq(paySheets.id, producerSheet.id));
        const [closedProducerAssociationBefore] = await database
          .select()
          .from(paySheetPolicies)
          .where(
            and(
              eq(paySheetPolicies.paySheetId, producerSheet.id),
              eq(paySheetPolicies.policyId, settledPolicy.id),
            ),
          );
        const [closedSophiaAssociationBefore] = await database
          .select()
          .from(paySheetPolicies)
          .where(
            and(
              eq(paySheetPolicies.paySheetId, sophiaSheet.id),
              eq(paySheetPolicies.policyId, settledPolicy.id),
            ),
          );
        assert.ok(closedProducerBefore);
        assert.ok(closedProducerAssociationBefore);
        assert.ok(closedSophiaAssociationBefore);
        assert.ok(closedProducerBefore.closedAt);
        assert.ok(closedProducerBefore.closedByUserId);
        assert.ok(closedProducerBefore.frozenTotals);
        assert.ok(closedProducerAssociationBefore.frozenPolicySnapshot);
        assert.ok(closedProducerAssociationBefore.frozenRateSnapshot);

        await expectDatabaseError("55000", () =>
          database
            .update(paySheets)
            .set({ status: "open" })
            .where(eq(paySheets.id, producerSheet.id)),
        );
        await expectDatabaseError("55000", () =>
          database
            .update(paySheets)
            .set({ frozenTotals: closedProducerBefore.frozenTotals })
            .where(eq(paySheets.id, producerSheet.id)),
        );
        await expectDatabaseError("55000", () =>
          database
            .update(paySheets)
            .set({ closedAt: closedProducerBefore.closedAt })
            .where(eq(paySheets.id, producerSheet.id)),
        );
        await expectDatabaseError("55000", () =>
          database
            .update(paySheets)
            .set({
              closedByUserId: closedProducerBefore.closedByUserId,
            })
            .where(eq(paySheets.id, producerSheet.id)),
        );

        const unrelatedUpdateAt = new Date(
          closedProducerBefore.updatedAt.getTime() + 1_000,
        );
        await database
          .update(paySheets)
          .set({ updatedAt: unrelatedUpdateAt })
          .where(eq(paySheets.id, producerSheet.id));
        const [closedProducerAfterUnrelatedUpdate] = await database
          .select()
          .from(paySheets)
          .where(eq(paySheets.id, producerSheet.id));
        assert.equal(
          closedProducerAfterUnrelatedUpdate?.updatedAt.toISOString(),
          unrelatedUpdateAt.toISOString(),
        );
        assert.deepEqual(
          {
            closedAt: closedProducerAfterUnrelatedUpdate?.closedAt,
            closedByUserId:
              closedProducerAfterUnrelatedUpdate?.closedByUserId,
            frozenTotals: closedProducerAfterUnrelatedUpdate?.frozenTotals,
            status: closedProducerAfterUnrelatedUpdate?.status,
          },
          {
            closedAt: closedProducerBefore.closedAt,
            closedByUserId: closedProducerBefore.closedByUserId,
            frozenTotals: closedProducerBefore.frozenTotals,
            status: "closed",
          },
        );

        await pool.query(
          "select set_config('wcib.pay_sheet_placement_context', 'placement', false)",
        );
        await expectDatabaseError("55000", () =>
          database.insert(paySheetPolicies).values({
            paySheetId: producerSheet.id,
            policyId: openPolicy.id,
          }),
        );
        await expectDatabaseError("55000", () =>
          database
            .update(paySheetPolicies)
            .set({
              frozenPolicySnapshot:
                closedProducerAssociationBefore.frozenPolicySnapshot,
            })
            .where(eq(paySheetPolicies.id, closedProducerAssociationBefore.id)),
        );
        await expectDatabaseError("55000", () =>
          database
            .update(paySheetPolicies)
            .set({
              frozenRateSnapshot:
                closedProducerAssociationBefore.frozenRateSnapshot,
            })
            .where(eq(paySheetPolicies.id, closedProducerAssociationBefore.id)),
        );
        await expectDatabaseError("55000", () =>
          database
            .delete(paySheetPolicies)
            .where(eq(paySheetPolicies.id, closedProducerAssociationBefore.id)),
        );
        await pool.query(
          "select set_config('wcib.pay_sheet_placement_context', '', false)",
        );

        const openPaidAt = new Date();
        await setMgaPaymentState(
          database,
          context,
          openPolicy.id,
          "paid",
          null,
          logger,
          openPaidAt,
        );
        const attached = await syncMgaPaymentSheetPlacement(
          database,
          context,
          openPolicy.id,
          true,
          logger,
          openPaidAt,
        );
        assert.equal(attached.associationCount, 2);
        const openAssociations = await database
          .select()
          .from(paySheetPolicies)
          .where(eq(paySheetPolicies.policyId, openPolicy.id));
        assert.equal(openAssociations.length, 2);
        assert.deepEqual(
          new Set(openAssociations.map((association) => association.paySheetId)),
          new Set([producerClose.nextSheetId, sophiaClose.nextSheetId]),
        );

        await database
          .update(paySheetPolicies)
          .set({ frozenPolicySnapshot: null })
          .where(eq(paySheetPolicies.id, openAssociations[0]!.id));

        const unpaidAt = new Date();
        await setMgaPaymentState(
          database,
          context,
          openPolicy.id,
          "unpaid",
          null,
          logger,
          unpaidAt,
        );
        const detached = await syncMgaPaymentSheetPlacement(
          database,
          context,
          openPolicy.id,
          false,
          logger,
          unpaidAt,
        );
        assert.equal(detached.associationCount, 2);
        assert.deepEqual(
          await database
            .select()
            .from(paySheetPolicies)
            .where(eq(paySheetPolicies.policyId, openPolicy.id)),
          [],
        );

        const [closedProducerAssociationAfter] = await database
          .select()
          .from(paySheetPolicies)
          .where(eq(paySheetPolicies.id, closedProducerAssociationBefore.id));
        const [closedSophiaAssociationAfter] = await database
          .select()
          .from(paySheetPolicies)
          .where(eq(paySheetPolicies.id, closedSophiaAssociationBefore.id));
        assert.deepEqual(
          closedProducerAssociationAfter,
          closedProducerAssociationBefore,
        );
        assert.deepEqual(
          closedSophiaAssociationAfter,
          closedSophiaAssociationBefore,
        );

        const serializedLogs = JSON.stringify(loggedEvents);
        for (const forbidden of [
          "150.00",
          "37.50",
          "IMMUTABLE-CLOSED",
          "IMMUTABLE-OPEN",
        ]) {
          assert.equal(serializedLogs.includes(forbidden), false);
        }
      } finally {
        await pool.end();
      }
    },
  );
});
