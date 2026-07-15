import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { test } from "node:test";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createDatabasePool } from "../db/client.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "../db/policy-test-fixture.js";
import {
  auditEvents,
  mgaPayments,
  paySheetPolicies,
  policies,
  producerRateHistory,
  userCapabilities,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { StructuredLogger } from "../logging/logger.js";
import { initializeSophiaPaySheet } from "../pay-sheets/initialize.js";
import { softDeletePolicy } from "./soft-delete.js";
import { changeMgaPayableGroupState } from "./mga-payable-group-state.js";

test("MGA group state is all-or-nothing and excludes deleted policies", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for MGA group test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_p5_mga_group",
    async (isolatedUrl) => {
      const pool = createDatabasePool(isolatedUrl);
      const database = drizzle(pool, { schema: databaseSchema });
      const logger = new StructuredLogger({ write() {} });
      try {
        const references = await createPolicyReferenceFixture(database);
        const context = adminContext(references.submittedByUserId);
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: references.submittedByUserId,
        });
        await database.insert(producerRateHistory).values({
          effectiveDate: "2000-01-01",
          newBrokerRate: "25.00",
          newCommissionRate: "25.00",
          producerUserId: references.producerUserId,
          renewalBrokerRate: "25.00",
          renewalCommissionRate: "25.00",
        });
        await initializeSophiaPaySheet(
          database,
          context,
          { periodMonth: 7, periodYear: 2026 },
          logger,
          new Date("2026-07-01T00:00:00.000Z"),
        );

        const createdAt = new Date("2026-07-11T12:00:00.000Z");
        const [first, second, deleted] = await database
          .insert(policies)
          .values([
            policy(references, "P-GROUP-1", "Group Alpha", createdAt),
            policy(references, "P-GROUP-2", "Group Beta", createdAt),
            policy(references, "P-GROUP-DELETED", "Deleted Group", createdAt),
          ])
          .returning();
        assert.ok(first && second && deleted);
        await softDeletePolicy(
          database,
          context,
          deleted.id,
          {
            expectedUpdatedAt: deleted.updatedAt,
            reason: "Verify group exclusion",
          },
          logger,
          new Date("2026-07-11T12:01:00.000Z"),
        );

        const paid = await changeMgaPayableGroupState(
          database,
          context,
          references.mgaId,
          { status: "paid" },
          logger,
          new Date("2026-07-11T13:00:00.000Z"),
        );
        assert.equal(paid.results.length, 2);
        assert.deepEqual(
          paid.results.map(({ placement }) => placement.associationCount),
          [2, 2],
        );
        assert.deepEqual(
          await currentStates(database, [first.id, second.id, deleted.id]),
          [
            { id: first.id, mgaPaid: true },
            { id: second.id, mgaPaid: true },
            { id: deleted.id, mgaPaid: false },
          ].sort(byId),
        );
        assert.equal((await database.select().from(paySheetPolicies)).length, 4);
        assert.equal(
          (await database.select().from(mgaPayments)).some(
            (payment) => payment.policyId === deleted.id,
          ),
          false,
        );

        const auditsAfterPaid = (await database.select().from(auditEvents)).length;
        const repeated = await changeMgaPayableGroupState(
          database,
          context,
          references.mgaId,
          { status: "paid" },
          logger,
          new Date("2026-07-11T13:01:00.000Z"),
        );
        assert.equal(repeated.results.length, 0);
        assert.equal(
          (await database.select().from(auditEvents)).length,
          auditsAfterPaid,
        );

        const unpaid = await changeMgaPayableGroupState(
          database,
          context,
          references.mgaId,
          { status: "unpaid" },
          logger,
          new Date("2026-07-11T14:00:00.000Z"),
        );
        assert.equal(unpaid.results.length, 2);
        assert.equal((await database.select().from(paySheetPolicies)).length, 0);

        const orderedIds = [first.id, second.id].sort();
        const failId = orderedIds[1]!;
        const auditCountBeforeFailure = (
          await database.select().from(auditEvents)
        ).length;
        await pool.query(`
          CREATE FUNCTION fail_parent_p_group_audit()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF NEW.action = 'mga_payment_marked_paid'
              AND NEW.after_summary ->> 'policyId' = '${failId}' THEN
              RAISE EXCEPTION 'forced second policy audit failure';
            END IF;
            RETURN NEW;
          END;
          $$
        `);
        await pool.query(`
          CREATE TRIGGER fail_parent_p_group_audit_trigger
          BEFORE INSERT ON audit_events
          FOR EACH ROW
          EXECUTE FUNCTION fail_parent_p_group_audit()
        `);
        await assert.rejects(
          changeMgaPayableGroupState(
            database,
            context,
            references.mgaId,
            { status: "paid" },
            logger,
            new Date("2026-07-11T15:00:00.000Z"),
          ),
          (error: unknown) =>
            error instanceof Error &&
            error.cause instanceof Error &&
            error.cause.message.includes("forced second policy audit failure"),
        );
        await pool.query(
          "DROP TRIGGER fail_parent_p_group_audit_trigger ON audit_events",
        );
        await pool.query("DROP FUNCTION fail_parent_p_group_audit() ");

        assert.deepEqual(
          await currentStates(database, [first.id, second.id]),
          [
            { id: first.id, mgaPaid: false },
            { id: second.id, mgaPaid: false },
          ].sort(byId),
        );
        assert.equal((await database.select().from(paySheetPolicies)).length, 0);
        assert.equal(
          (await database.select().from(auditEvents)).length,
          auditCountBeforeFailure,
        );
        assert.equal(
          (await database.select().from(mgaPayments)).every(
            (payment) => payment.status === "unpaid",
          ),
          true,
        );
      } finally {
        await pool.end();
      }
    },
  );
});

function policy(
  references: Awaited<ReturnType<typeof createPolicyReferenceFixture>>,
  policyNumber: string,
  insuredName: string,
  createdAt: Date,
) {
  return policyTestInput(references, {
    accountAssignment: "book",
    amountPaid: "1000.00",
    basePremium: "1000.00",
    brokerFee: "50.00",
    commissionAmount: "100.00",
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "10.0000",
    createdAt,
    insuredName,
    kayleeSplit: "book",
    netDue: "850.00",
    paymentMode: "full",
    policyNumber,
    producerUserId: references.producerUserId,
    proposalTotal: "1050.00",
    sourceDraftId: null,
    updatedAt: createdAt,
  });
}

async function currentStates(
  database: ReturnType<typeof drizzle<typeof databaseSchema>>,
  ids: readonly string[],
): Promise<Array<{ id: string; mgaPaid: boolean }>> {
  return database
    .select({ id: policies.id, mgaPaid: policies.mgaPaid })
    .from(policies)
    .where(inArray(policies.id, [...ids]))
    .orderBy(policies.id);
}

function byId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
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
