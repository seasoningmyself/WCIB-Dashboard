import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "../db/policy-test-fixture.js";
import {
  paySheets,
  policies,
  producerRateHistory,
  userCapabilities,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import { closePaySheet } from "../pay-sheets/close.js";
import { syncMgaPaymentSheetPlacement } from "../pay-sheets/mga-placement.js";
import { setMgaPaymentState } from "../policies/mga-payments.js";
import { applyPolicyCorrection } from "../policies/corrections.js";
import {
  deriveClosedKpiActualInputs,
  listClosedKpiFacts,
} from "./closed-facts.js";

const logger: AppLogger = {
  error() {},
  info() {},
  warn() {},
};

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

test("closed KPI facts do not drift after the live policy changes", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for KPI fact DB test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_stone70_kpi",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 1 });
      const database = drizzle(pool, { schema: databaseSchema });

      try {
        const references = await createPolicyReferenceFixture(database);
        const admin = await createUser(database, {
          email: `kpi-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        await database.insert(producerRateHistory).values({
          effectiveDate: "2000-01-01",
          newBrokerRate: "25.00",
          newCommissionRate: "25.00",
          producerUserId: references.producerUserId,
          renewalBrokerRate: "25.00",
          renewalCommissionRate: "25.00",
        });
        const context = adminContext(admin.id);
        const createdAt = new Date(Date.now() - 60_000);
        const [policy] = await database
          .insert(policies)
          .values(
            policyTestInput(references, {
              basePremium: "1000.00",
              brokerFee: "50.00",
              commissionAmount: "100.00",
              commissionConfirmed: true,
              commissionMode: "pct",
              commissionRate: "10.0000",
              kayleeSplit: "book",
              amountPaid: "1000.00",
              netDue: "850.00",
              policyNumber: "KPI-WON-BACK",
              producerUserId: references.producerUserId,
              proposalTotal: "1050.00",
              sourceDraftId: null,
              transactionType: "Won Back",
            }),
          )
          .returning();
        assert.ok(policy);

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

        assert.deepEqual(
          await listClosedKpiFacts(database, {
            scopeType: "company",
            year: 2026,
          }),
          [],
        );

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
        const placement = await syncMgaPaymentSheetPlacement(
          database,
          context,
          policy.id,
          true,
          logger,
          paidAt,
        );
        assert.equal(placement.associationCount, 2);
        await closePaySheet(database, context, sophiaSheet.id, logger);
        await closePaySheet(database, context, producerSheet.id, logger);

        const companyAtClose = await listClosedKpiFacts(database, {
          periodMonths: [7],
          scopeType: "company",
          year: 2026,
        });
        const producerAtClose = await listClosedKpiFacts(database, {
          periodMonths: [7],
          producerUserId: references.producerUserId,
          scopeType: "producer",
          year: 2026,
        });
        assert.equal(companyAtClose.length, 1);
        assert.equal(producerAtClose.length, 1);
        assert.equal(companyAtClose[0]?.ownerType, "sophia");
        assert.equal(producerAtClose[0]?.ownerType, "producer");

        const [livePolicyBeforeCorrection] = await database
          .select({ updatedAt: policies.updatedAt })
          .from(policies)
          .where(eq(policies.id, policy.id));
        assert.ok(livePolicyBeforeCorrection);
        await applyPolicyCorrection(
          database,
          context,
          policy.id,
          "Verify frozen KPI facts against a corrected live policy",
          {
            insuredName: "Changed Live Policy",
            transactionType: "New",
          },
          ["insuredName", "transactionType"],
          livePolicyBeforeCorrection.updatedAt,
          logger,
          new Date("2026-08-02T12:00:00.000Z"),
        );

        assert.deepEqual(
          await listClosedKpiFacts(database, {
            periodMonths: [7],
            scopeType: "company",
            year: 2026,
          }),
          companyAtClose,
        );
        assert.deepEqual(
          await listClosedKpiFacts(database, {
            periodMonths: [7],
            producerUserId: references.producerUserId,
            scopeType: "producer",
            year: 2026,
          }),
          producerAtClose,
        );
        assert.deepEqual(
          await listClosedKpiFacts(database, {
            periodMonths: [6],
            scopeType: "company",
            year: 2026,
          }),
          [],
        );

        const actualInputs = deriveClosedKpiActualInputs(companyAtClose);
        assert.equal(actualInputs.newPolicyCount, 0);
        assert.equal(actualInputs.newRevenueCents, 0n);
        assert.equal(actualInputs.retentionNumerator, 1);
        assert.equal(actualInputs.retentionDenominator, 1);
        assert.deepEqual(actualInputs.transactionTypeCounts, { "Won Back": 1 });
        assert.equal(companyAtClose[0]?.snapshot.agencyRevenue, "150.00");
      } finally {
        await pool.end();
      }
    },
  );
});
