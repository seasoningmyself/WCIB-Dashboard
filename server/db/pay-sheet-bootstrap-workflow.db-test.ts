import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { CreateDraftRequest } from "../../shared/drafts.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import { approvePendingSubmission } from "../approval-queue/approve.js";
import type { AppLogger } from "../logging/logger.js";
import { closePaySheet } from "../pay-sheets/close.js";
import { initializeSophiaPaySheet } from "../pay-sheets/initialize.js";
import { changeMgaPayableState } from "../policies/mga-payable-state.js";
import { createOwnDraft } from "../drafts/create.js";
import { submitOwnDraft } from "../drafts/submit.js";
import { withDisposableMigratedDatabase } from "./disposable-database-test-helper.js";
import { createPolicyReferenceFixture } from "./policy-test-fixture.js";
import {
  approvalQueueEntries,
  paySheetPolicies,
  paySheets,
  policies,
  producerRateHistory,
  userCapabilities,
} from "./schema.js";
import * as databaseSchema from "./schema.js";

const logger: AppLogger = { error() {}, info() {}, warn() {} };

test("a blank migrated database reaches a closed payroll period and open successor", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for bootstrap workflow test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_sheet_flow",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 6 });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        assert.equal(await tableCount(pool, "pay_sheets"), 0);
        assert.equal(await tableCount(pool, "policies"), 0);

        const references = await createPolicyReferenceFixture(database);
        const admin = await createUser(database, {
          email: `sheet-flow-admin-${randomUUID()}@example.test`,
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
        const employeeContext = staffContext(
          references.submittedByUserId,
          "employee",
        );
        const adminContext = adminAccess(admin.id);

        const bootstrap = await initializeSophiaPaySheet(
          database,
          adminContext,
          { periodMonth: 6, periodYear: 2026 },
          logger,
          new Date("2026-06-01T00:00:00.000Z"),
        );
        assert.equal(bootstrap.created, true);

        const draft = await createOwnDraft(
          database,
          employeeContext,
          completeTurnIn(references),
          new Date("2026-07-13T01:00:00.000Z"),
        );
        const submitted = await submitOwnDraft(
          database,
          employeeContext,
          draft.id,
          new Date("2026-07-13T02:00:00.000Z"),
        );
        assert.equal(submitted.destination, "approval");
        const [queue] = await database
          .select()
          .from(approvalQueueEntries)
          .where(eq(approvalQueueEntries.draftId, draft.id));
        assert.ok(queue);
        const policy = await approvePendingSubmission(
          database,
          adminContext,
          queue.id,
          new Date("2026-07-13T03:00:00.000Z"),
        );
        assert.equal(policy.sourceDraftId, draft.id);

        const placement = await changeMgaPayableState(
          database,
          adminContext,
          policy.id,
          { reference: "FLOW-MGA-PAID", status: "paid" },
          logger,
          new Date("2026-07-13T04:00:00.000Z"),
        );
        assert.equal(placement.placement.associationCount, 2);
        const openSheets = await database
          .select()
          .from(paySheets)
          .where(eq(paySheets.status, "open"));
        assert.deepEqual(
          openSheets
            .map(({ ownerType, periodMonth, periodYear }) => ({
              ownerType,
              periodMonth,
              periodYear,
            }))
            .sort((left, right) => left.ownerType.localeCompare(right.ownerType)),
          [
            { ownerType: "producer", periodMonth: 6, periodYear: 2026 },
            { ownerType: "sophia", periodMonth: 6, periodYear: 2026 },
          ],
        );

        const producerSheet = openSheets.find(
          ({ ownerType }) => ownerType === "producer",
        );
        const sophiaSheet = openSheets.find(
          ({ ownerType }) => ownerType === "sophia",
        );
        assert.ok(producerSheet && sophiaSheet);
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
        assert.equal(producerClose.closed, true);
        assert.equal(sophiaClose.closed, true);

        const closedSheets = await database
          .select()
          .from(paySheets)
          .where(eq(paySheets.status, "closed"));
        const successorSheets = await database
          .select()
          .from(paySheets)
          .where(
            and(
              eq(paySheets.status, "open"),
              eq(paySheets.periodMonth, 7),
              eq(paySheets.periodYear, 2026),
            ),
          );
        assert.equal(closedSheets.length, 2);
        assert.equal(successorSheets.length, 2);
        assert.deepEqual(
          new Set(successorSheets.map(({ ownerType }) => ownerType)),
          new Set(["producer", "sophia"]),
        );
        const frozenAssociations = await database
          .select()
          .from(paySheetPolicies)
          .where(eq(paySheetPolicies.policyId, policy.id));
        assert.equal(frozenAssociations.length, 2);
        assert.equal(
          frozenAssociations.every(
            ({ frozenPolicySnapshot }) => frozenPolicySnapshot !== null,
          ),
          true,
        );
        const [storedPolicy] = await database
          .select()
          .from(policies)
          .where(eq(policies.id, policy.id));
        assert.equal(storedPolicy?.mgaPaid, true);
      } finally {
        await pool.end();
      }
    },
  );
});

function completeTurnIn(
  references: Awaited<ReturnType<typeof createPolicyReferenceFixture>>,
): CreateDraftRequest {
  return {
    accountAssignment: "book",
    amountPaid: "1000.00",
    basePremium: "1000.00",
    brokerFee: "50.00",
    carrierId: references.carrierId,
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "10.0000",
    effectiveDate: "2026-07-13",
    expirationDate: "2027-07-13",
    insuredName: "Blank database payroll proof",
    mgaFee: "0.00",
    mgaId: references.mgaId,
    officeLocationId: references.officeLocationId,
    paymentMode: "full",
    policyNumber: "K1-BLANK-WORKFLOW",
    policyTypeId: references.policyTypeId,
    producerUserId: references.producerUserId,
    proposalTotal: "1050.00",
    taxes: "0.00",
    transactionType: "New",
  };
}

function staffContext(
  userId: string,
  staffRole: "employee" | "producer",
): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: [],
      staffRole,
      userActive: true,
      userId,
    },
  };
}

function adminAccess(userId: string): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: ["admin"],
      staffRole: null,
      userActive: true,
      userId,
    },
  };
}

async function tableCount(
  pool: pg.Pool,
  table: "pay_sheets" | "policies",
): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `SELECT count(*)::integer AS count FROM ${table}`,
  );
  return result.rows[0]?.count ?? 0;
}
