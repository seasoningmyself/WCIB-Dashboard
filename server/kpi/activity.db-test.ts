import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import { resetBusinessState } from "../business-state/service.js";
import { createDatabasePool } from "../db/client.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "../db/policy-test-fixture.js";
import {
  auditEvents,
  paySheets,
  policies,
  userCapabilities,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import { buildPaySheetFrozenTotals } from "../pay-sheets/frozen-totals.js";
import { softDeletePolicy } from "../policies/soft-delete.js";
import { loadKpiRecentActivitySource } from "./activity.js";

const logger: AppLogger = { error() {}, info() {}, warn() {} };

test("recent KPI activity follows the active generation and omits deleted policies", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for KPI activity DB test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_kpi_activity",
    async (isolatedUrl) => {
      const pool = createDatabasePool(isolatedUrl);
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const admin = await createUser(database, {
          displayName: `Activity Admin ${randomUUID()}`,
          email: `activity-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const context = adminContext(admin.id);
        const initialReferences = await createPolicyReferenceFixture(database);
        const policyVersionAt = new Date("2026-07-23T09:00:00.000Z");
        const [visiblePolicy, deletedPolicy] = await database
          .insert(policies)
          .values([
            policyTestInput(initialReferences, {
              createdAt: policyVersionAt,
              policyNumber: "ACTIVITY-VISIBLE",
              sourceDraftId: null,
              updatedAt: policyVersionAt,
            }),
            policyTestInput(initialReferences, {
              createdAt: policyVersionAt,
              policyNumber: "ACTIVITY-DELETED",
              sourceDraftId: null,
              updatedAt: policyVersionAt,
            }),
          ])
          .returning();
        assert.ok(visiblePolicy);
        assert.ok(deletedPolicy);
        await database.insert(auditEvents).values([
          {
            action: "policy_approved",
            actorUserId: admin.id,
            entityId: visiblePolicy.id,
            entityType: "policy",
            occurredAt: new Date("2026-07-23T10:00:00.000Z"),
          },
          {
            action: "policy_approved",
            actorUserId: admin.id,
            entityId: deletedPolicy.id,
            entityType: "policy",
            occurredAt: new Date("2026-07-23T11:00:00.000Z"),
          },
        ]);
        const [closedSheet] = await database
          .insert(paySheets)
          .values({
            closedAt: new Date("2026-07-23T09:30:00.000Z"),
            closedByUserId: admin.id,
            createdAt: new Date("2026-07-23T08:00:00.000Z"),
            frozenTotals: buildPaySheetFrozenTotals("sophia", {
              brokerFees: "0.00",
              commissions: "0.00",
              directCheckAchIncome: "0.00",
              grandTotalIncome: "0.00",
              sophiaAgencyGross: "0.00",
              sophiaShare: "0.00",
              sophiaTakeHome: "0.00",
              trustPull: "0.00",
            }),
            openedAt: new Date("2026-07-23T08:00:00.000Z"),
            ownerType: "sophia",
            ownerUserId: admin.id,
            periodMonth: 7,
            periodYear: 2026,
            status: "closed",
            updatedAt: new Date("2026-07-23T09:30:00.000Z"),
          })
          .returning();
        assert.ok(closedSheet);
        await database.insert(auditEvents).values({
          action: "pay_sheet_closed",
          actorUserId: admin.id,
          entityId: closedSheet.id,
          entityType: "pay_sheet",
          occurredAt: new Date("2026-07-23T09:30:00.000Z"),
        });
        await softDeletePolicy(
          database,
          context,
          deletedPolicy.id,
          {
            expectedUpdatedAt: deletedPolicy.updatedAt,
            reason: "Superseded QA policy",
          },
          logger,
          new Date("2026-07-23T11:30:00.000Z"),
        );

        assert.deepEqual(
          (await loadKpiRecentActivitySource(database, context)).activities.map(
            ({ targetReference }) => targetReference,
          ),
          ["Policy ACTIVITY-VISIBLE", "Pay sheet July 2026"],
        );

        await resetBusinessState(
          database,
          context,
          { clearKpiTargets: false, confirmation: "RESET" },
          new Date("2026-07-23T12:00:00.000Z"),
        );
        assert.deepEqual(
          (await loadKpiRecentActivitySource(database, context)).activities,
          [],
        );

        const activeReferences = await createPolicyReferenceFixture(database);
        const [activePolicy] = await database
          .insert(policies)
          .values(
            policyTestInput(activeReferences, {
              policyNumber: "ACTIVITY-ACTIVE-GENERATION",
              sourceDraftId: null,
            }),
          )
          .returning();
        assert.ok(activePolicy);
        await database.insert(auditEvents).values({
          action: "policy_approved",
          actorUserId: admin.id,
          entityId: activePolicy.id,
          entityType: "policy",
          occurredAt: new Date("2026-07-23T13:00:00.000Z"),
        });

        assert.deepEqual(
          (await loadKpiRecentActivitySource(database, context)).activities.map(
            ({ targetReference }) => targetReference,
          ),
          ["Policy ACTIVITY-ACTIVE-GENERATION"],
        );
      } finally {
        await pool.end();
      }
    },
  );
});

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
