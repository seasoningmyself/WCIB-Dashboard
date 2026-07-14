import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import { listMyCommissionSources } from "../commissions/read.js";
import { listOwnDrafts } from "../drafts/list.js";
import { listOwnMyItemSources } from "../drafts/my-items.js";
import { loadKpiActualSource } from "../kpi/actuals.js";
import type { AppLogger } from "../logging/logger.js";
import { closePaySheetWithCascade } from "../pay-sheets/close.js";
import { initializeSophiaPaySheet } from "../pay-sheets/initialize.js";
import {
  listPaySheetSources,
  projectAdminPaySheetDetail,
} from "../pay-sheets/read.js";
import {
  createOwnPolicyChangeRequest,
  listOwnPolicyChangeRequests,
  listPendingPolicyChangeRequests,
} from "../policy-change-requests/service.js";
import {
  correctPolicyLedgerItem,
  PolicyLedgerCorrectionNotFoundError,
} from "../policies/ledger-corrections.js";
import {
  listDeletedPolicyLedgerItems,
  listPolicyLedger,
} from "../policies/ledger.js";
import { changeMgaPayableState } from "../policies/mga-payable-state.js";
import { listMgaPayableSources } from "../policies/mga-payables.js";
import {
  PolicyDeletionValidationError,
  restorePolicy,
  softDeletePolicy,
} from "../policies/soft-delete.js";
import { withDisposableMigratedDatabase } from "./disposable-database-test-helper.js";
import { readDatabaseErrorCode } from "./error-code.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
  type PolicyReferenceFixture,
} from "./policy-test-fixture.js";
import {
  auditEvents,
  drafts,
  mgaPayments,
  paySheetPolicies,
  paySheets,
  policies,
  producerRateHistory,
  userCapabilities,
  type PolicyRecord,
} from "./schema.js";
import * as databaseSchema from "./schema.js";

const logger: AppLogger = { error() {}, info() {}, warn() {} };

test("policy soft-delete preserves closed facts and removes every live surface", async (testContext) => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for policy deletion test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_policy_delete",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 8 });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const fixture = await setup(database);
        const settled = await createPaidPolicy(database, fixture, {
          approvedAt: new Date("2026-06-05T12:00:00.000Z"),
          paidAt: new Date("2026-06-10T12:00:00.000Z"),
          policyNumber: "DELETE-SETTLED",
          sourceDraftId: fixture.references.sourceDraftId,
        });
        await createOwnPolicyChangeRequest(
          database,
          fixture.producerContext,
          settled.id,
          { reason: "Please review this approved record" },
          logger,
          new Date("2026-06-11T12:00:00.000Z"),
        );

        const close = await closePaySheetWithCascade(
          database,
          fixture.adminContext,
          fixture.sophiaSheetId,
          true,
          logger,
        );
        assert.equal(close.primary.closed, true);
        assert.equal(close.cascaded.length, 1);

        const beforeFrozen = await frozenState(pool, settled.id);
        const beforeHash = hashFrozenState(beforeFrozen);
        const closedSourceBefore = await listPaySheetSources(
          database,
          fixture.adminContext,
          { ownerType: "all", ownerUserId: null, periodMonth: 6, periodYear: 2026, status: "closed" },
        );
        const closedPolicyBefore = projectedPolicyIds(closedSourceBefore, fixture.adminContext);
        assert.equal(closedPolicyBefore.filter((id) => id === settled.id).length, 2);
        const kpiBefore = await loadKpiActualSource(
          database,
          fixture.adminContext,
          { period: "full", scopeType: "company", year: 2026 },
        );
        const commissionsBefore = await listMyCommissionSources(
          database,
          fixture.producerContext,
          {},
          new Date("2026-07-15T12:00:00.000Z"),
        );
        assert.equal(commissionsBefore.items.some(({ id }) => id === settled.id), true);
        assert.equal(
          (await listOwnDrafts(database, fixture.producerContext, {})).some(
            ({ id }) => id === fixture.references.sourceDraftId,
          ),
          true,
        );
        assert.equal(
          (await listOwnMyItemSources(database, fixture.producerContext)).some(
            ({ id }) => id === fixture.references.sourceDraftId,
          ),
          true,
        );
        assert.equal(
          (await listOwnPolicyChangeRequests(database, fixture.producerContext)).length,
          1,
        );

        const currentSettled = await requirePolicy(database, settled.id);
        const removed = await softDeletePolicy(
          database,
          fixture.adminContext,
          settled.id,
          {
            expectedUpdatedAt: currentSettled.updatedAt,
            reason: "Duplicate settled ledger entry",
          },
          logger,
          new Date("2026-10-01T12:00:00.000Z"),
        );
        assert.equal(removed.changed, true);
        assert.equal(removed.detachedOpenSheetCount, 0);
        assert.equal(await deletionAuditCount(database, settled.id, "policy_soft_deleted"), 1);
        const repeatedRemoval = await softDeletePolicy(
          database,
          fixture.adminContext,
          settled.id,
          {
            expectedUpdatedAt: currentSettled.updatedAt,
            reason: "Idempotent retry must not append an audit",
          },
          logger,
          new Date("2026-08-01T12:00:01.000Z"),
        );
        assert.equal(repeatedRemoval.changed, false);
        assert.equal(await deletionAuditCount(database, settled.id, "policy_soft_deleted"), 1);

        const afterFrozen = await frozenState(pool, settled.id);
        const afterHash = hashFrozenState(afterFrozen);
        assert.equal(afterHash, beforeHash);
        assert.deepEqual(afterFrozen, beforeFrozen);
        testContext.diagnostic(`frozen snapshot hash before=${beforeHash} after=${afterHash}`);
        assert.deepEqual(
          await loadKpiActualSource(
            database,
            fixture.adminContext,
            { period: "full", scopeType: "company", year: 2026 },
          ),
          kpiBefore,
        );
        const closedSourceAfter = await listPaySheetSources(
          database,
          fixture.adminContext,
          { ownerType: "all", ownerUserId: null, periodMonth: 6, periodYear: 2026, status: "closed" },
        );
        assert.deepEqual(
          projectedPolicyIds(closedSourceAfter, fixture.adminContext),
          closedPolicyBefore,
        );

        const ledger = await listPolicyLedger(
          database,
          fixture.adminContext,
          { month: "2026-06" },
        );
        assert.equal(ledger.items.some(({ policy }) => policy.id === settled.id), false);
        const payables = await listMgaPayableSources(
          database,
          fixture.adminContext,
          { status: "all" },
        );
        assert.equal(payables.items.some(({ policy }) => policy.id === settled.id), false);
        const commissionsAfter = await listMyCommissionSources(
          database,
          fixture.producerContext,
          {},
          new Date("2026-07-15T12:00:00.000Z"),
        );
        assert.equal(commissionsAfter.items.some(({ id }) => id === settled.id), false);
        assert.equal(
          (await listOwnDrafts(database, fixture.producerContext, {})).some(
            ({ id }) => id === fixture.references.sourceDraftId,
          ),
          false,
        );
        assert.equal(
          (await listOwnMyItemSources(database, fixture.producerContext)).some(
            ({ id }) => id === fixture.references.sourceDraftId,
          ),
          false,
        );
        assert.equal(
          (await listOwnPolicyChangeRequests(database, fixture.producerContext)).length,
          0,
        );
        assert.equal(
          (await listPendingPolicyChangeRequests(database, fixture.adminContext)).length,
          0,
        );
        assert.equal(
          (await listDeletedPolicyLedgerItems(database, fixture.adminContext)).some(
            ({ policy }) => policy.id === settled.id,
          ),
          true,
        );
        await assert.rejects(
          correctPolicyLedgerItem(
            database,
            fixture.adminContext,
            settled.id,
            {
              change: {
                changedFields: ["insuredName"],
                reason: "Must not correct deleted record",
                replacementValues: { insuredName: "Changed" },
              },
              expectedUpdatedAt: "2026-10-01T12:00:00.000Z",
              kind: "general",
            },
            logger,
            new Date("2026-10-02T12:00:00.000Z"),
          ),
          PolicyLedgerCorrectionNotFoundError,
        );

        const restoredSettled = await restorePolicy(
          database,
          fixture.adminContext,
          settled.id,
          { expectedUpdatedAt: "2026-10-01T12:00:00.000Z" },
          logger,
          new Date("2026-10-02T12:00:00.000Z"),
        );
        assert.equal(restoredSettled.changed, true);
        assert.equal(await deletionAuditCount(database, settled.id, "policy_restored"), 1);
        const repeatedRestore = await restorePolicy(
          database,
          fixture.adminContext,
          settled.id,
          { expectedUpdatedAt: "2026-08-01T12:00:00.000Z" },
          logger,
          new Date("2026-08-02T12:00:01.000Z"),
        );
        assert.equal(repeatedRestore.changed, false);
        assert.equal(await deletionAuditCount(database, settled.id, "policy_restored"), 1);
        assert.equal(await associationCount(database, settled.id, "open"), 0);
        assert.equal(await associationCount(database, settled.id, "closed"), 2);
        assert.equal(hashFrozenState(await frozenState(pool, settled.id)), beforeHash);
      } finally {
        await pool.end();
      }
    },
  );
});

test("open deletion detaches atomically, restores safely, and guards attachment", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for policy deletion test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_policy_restore",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 8 });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const fixture = await setup(database);
        const openPolicy = await createPaidPolicy(database, fixture, {
          approvedAt: new Date("2026-06-05T12:00:00.000Z"),
          paidAt: new Date("2026-06-10T12:00:00.000Z"),
          policyNumber: "DELETE-OPEN",
          sourceDraftId: fixture.references.sourceDraftId,
        });
        assert.equal(await associationCount(database, openPolicy.id, "open"), 2);
        const paymentBefore = await paymentState(database, openPolicy.id);
        const current = await requirePolicy(database, openPolicy.id);
        await assert.rejects(
          database
            .update(policies)
            .set({
              deleteReason: "Direct mutation is forbidden",
              deletedAt: new Date("2026-07-01T11:00:00.000Z"),
              deletedByUserId: fixture.adminContext.principal.userId,
            })
            .where(eq(policies.id, openPolicy.id)),
          (error: unknown) => readDatabaseErrorCode(error) === "55000",
        );
        const runtimeRole = `wcib_runtime_test_${randomUUID().replaceAll("-", "")}`;
        await pool.query(`CREATE ROLE "${runtimeRole}" NOLOGIN`);
        try {
          await pool.query(`GRANT USAGE ON SCHEMA public TO "${runtimeRole}"`);
          await pool.query(`GRANT SELECT, UPDATE ON policies TO "${runtimeRole}"`);
          await assert.rejects(
            database.transaction(async (transaction) => {
              await transaction.execute(sql.raw(`SET LOCAL ROLE "${runtimeRole}"`));
              await transaction.execute(sql`
                select set_config('wcib.policy_deletion_context', 'delete', true)
              `);
              await transaction
                .update(policies)
                .set({
                  deleteReason: "Spoofed context must not bypass the trusted path",
                  deletedAt: new Date("2026-07-01T11:30:00.000Z"),
                  deletedByUserId: fixture.adminContext.principal.userId,
                })
                .where(eq(policies.id, openPolicy.id));
            }),
            (error: unknown) => readDatabaseErrorCode(error) === "55000",
          );
        } finally {
          await pool.query(`DROP OWNED BY "${runtimeRole}"`);
          await pool.query(`DROP ROLE IF EXISTS "${runtimeRole}"`);
        }
        const deleted = await softDeletePolicy(
          database,
          fixture.adminContext,
          openPolicy.id,
          { expectedUpdatedAt: current.updatedAt, reason: "Remove from active work" },
          logger,
          new Date("2026-07-01T12:00:00.000Z"),
        );
        assert.equal(deleted.detachedOpenSheetCount, 2);
        assert.equal(await associationCount(database, openPolicy.id, "open"), 0);
        assert.deepEqual(await paymentState(database, openPolicy.id), paymentBefore);
        const deletedRecord = await requirePolicy(database, openPolicy.id);
        assert.equal(deletedRecord.mgaPaid, true);

        const openSources = await listPaySheetSources(
          database,
          fixture.adminContext,
          { ownerType: "all", ownerUserId: null, periodMonth: 6, periodYear: 2026, status: "open" },
        );
        assert.equal(
          projectedPolicyIds(openSources, fixture.adminContext).includes(openPolicy.id),
          false,
        );

        const restored = await restorePolicy(
          database,
          fixture.adminContext,
          openPolicy.id,
          { expectedUpdatedAt: deletedRecord.updatedAt },
          logger,
          new Date("2026-07-02T12:00:00.000Z"),
        );
        assert.equal(restored.changed, true);
        assert.equal(await associationCount(database, openPolicy.id, "open"), 2);
        assert.equal(await deletionAuditCount(database, openPolicy.id, "policy_soft_deleted"), 1);
        assert.equal(await deletionAuditCount(database, openPolicy.id, "policy_restored"), 1);

        await installAuditFailure(pool, "policy_soft_deleted");
        await assert.rejects(
          softDeletePolicy(
            database,
            fixture.adminContext,
            openPolicy.id,
            {
              expectedUpdatedAt: "2026-07-02T12:00:00.000Z",
              reason: "This transaction must roll back",
            },
            logger,
            new Date("2026-07-03T12:00:00.000Z"),
          ),
          PolicyDeletionValidationError,
        );
        assert.equal((await requirePolicy(database, openPolicy.id)).deletedAt, null);
        assert.equal(await associationCount(database, openPolicy.id, "open"), 2);
        assert.equal(await deletionAuditCount(database, openPolicy.id, "policy_soft_deleted"), 1);
        await removeAuditFailure(pool);

        await softDeletePolicy(
          database,
          fixture.adminContext,
          openPolicy.id,
          {
            expectedUpdatedAt: "2026-07-02T12:00:00.000Z",
            reason: "Delete after rollback proof",
          },
          logger,
          new Date("2026-07-04T12:00:00.000Z"),
        );
        await installAuditFailure(pool, "policy_restored");
        await assert.rejects(
          restorePolicy(
            database,
            fixture.adminContext,
            openPolicy.id,
            { expectedUpdatedAt: "2026-07-04T12:00:00.000Z" },
            logger,
            new Date("2026-07-05T12:00:00.000Z"),
          ),
          PolicyDeletionValidationError,
        );
        assert.notEqual((await requirePolicy(database, openPolicy.id)).deletedAt, null);
        assert.equal(await associationCount(database, openPolicy.id, "open"), 0);
        assert.equal(await deletionAuditCount(database, openPolicy.id, "policy_soft_deleted"), 2);
        assert.equal(await deletionAuditCount(database, openPolicy.id, "policy_restored"), 1);
        await removeAuditFailure(pool);

        const [openSheet] = await database
          .select({ id: paySheets.id })
          .from(paySheets)
          .where(and(eq(paySheets.ownerType, "sophia"), eq(paySheets.status, "open")))
          .limit(1);
        assert.ok(openSheet);
        await assert.rejects(
          database.insert(paySheetPolicies).values({
            paySheetId: openSheet.id,
            policyId: openPolicy.id,
          }),
          (error: unknown) => readDatabaseErrorCode(error) === "55000",
        );
        await assert.rejects(
          changeMgaPayableState(
            database,
            fixture.adminContext,
            openPolicy.id,
            { reference: "REATTACH-BLOCKED", status: "paid" },
            logger,
            new Date("2026-07-06T12:00:00.000Z"),
          ),
        );
        assert.equal(await associationCount(database, openPolicy.id, "open"), 0);
        assert.deepEqual(await paymentState(database, openPolicy.id), paymentBefore);
      } finally {
        await removeAuditFailure(pool).catch(() => undefined);
        await pool.end();
      }
    },
  );
});

test("policy deletion and pay-sheet close serialize without partial state", async (testContext) => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for policy deletion test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_delete_close",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 8 });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const fixture = await setup(database);
        const policy = await createPaidPolicy(database, fixture, {
          approvedAt: new Date("2026-06-05T12:00:00.000Z"),
          paidAt: new Date("2026-06-10T12:00:00.000Z"),
          policyNumber: "DELETE-CLOSE-RACE",
          sourceDraftId: fixture.references.sourceDraftId,
        });
        const current = await requirePolicy(database, policy.id);
        const [deleted, closed] = await withTimeout(
          Promise.allSettled([
            softDeletePolicy(
              database,
              fixture.adminContext,
              policy.id,
              { expectedUpdatedAt: current.updatedAt, reason: "Concurrent close proof" },
              logger,
              new Date("2026-07-01T12:00:00.000Z"),
            ),
            closePaySheetWithCascade(
              database,
              fixture.adminContext,
              fixture.sophiaSheetId,
              true,
              logger,
            ),
          ]),
          8_000,
        );
        assert.equal(deleted.status, "fulfilled");
        assert.equal(deleted.status === "fulfilled" && deleted.value.changed, true);
        assert.notEqual((await requirePolicy(database, policy.id)).deletedAt, null);
        assert.equal(await associationCount(database, policy.id, "open"), 0);
        const closedAssociations = await associationCount(database, policy.id, "closed");
        assert.ok(closedAssociations === 0 || closedAssociations === 2);
        const [sophia] = await database
          .select()
          .from(paySheets)
          .where(eq(paySheets.id, fixture.sophiaSheetId));
        if (closed.status === "fulfilled") {
          assert.equal(closed.value.primary.closed, true);
          assert.equal(sophia?.status, "closed");
          assert.notEqual(sophia?.frozenTotals, null);
          assert.equal(closedAssociations, 2);
          testContext.diagnostic("delete-vs-close outcome=close-then-delete");
        } else {
          assert.equal(sophia?.status, "open");
          assert.equal(sophia?.frozenTotals, null);
          assert.equal(closedAssociations, 0);
          testContext.diagnostic("delete-vs-close outcome=delete-then-safe-close-rejection");
        }
      } finally {
        await pool.end();
      }
    },
  );
});

interface SetupFixture {
  adminContext: AuthorizedRequestContext;
  producerContext: AuthorizedRequestContext;
  references: PolicyReferenceFixture;
  sophiaSheetId: string;
}

type TestDatabase = ReturnType<typeof drizzle<typeof databaseSchema>>;

async function setup(database: TestDatabase): Promise<SetupFixture> {
  const references = await createPolicyReferenceFixture(database);
  const admin = await createUser(database, {
    email: `policy-delete-admin-${randomUUID()}@example.test`,
    password: "StrongPass123!",
  });
  await database.insert(userCapabilities).values({ capability: "admin", userId: admin.id });
  await database.insert(producerRateHistory).values({
    effectiveDate: "2000-01-01",
    newBrokerRate: "25.00",
    newCommissionRate: "25.00",
    producerUserId: references.producerUserId,
    renewalBrokerRate: "25.00",
    renewalCommissionRate: "25.00",
  });
  const [sourceDraft] = await database
    .insert(drafts)
    .values({
      createdAt: new Date("2026-05-31T12:00:00.000Z"),
      insuredName: "Visible source draft",
      lastEditedAt: new Date("2026-06-01T12:00:00.000Z"),
      ownerUserId: references.producerUserId,
    })
    .returning({ id: drafts.id });
  assert.ok(sourceDraft);
  const adminContext = context(admin.id, null, ["admin"]);
  const bootstrap = await initializeSophiaPaySheet(
    database,
    adminContext,
    { periodMonth: 6, periodYear: 2026 },
    logger,
    new Date("2026-06-01T00:00:00.000Z"),
  );
  return {
    adminContext,
    producerContext: context(references.producerUserId, "producer"),
    references: { ...references, sourceDraftId: sourceDraft.id },
    sophiaSheetId: bootstrap.paySheetId,
  };
}

async function createPaidPolicy(
  database: TestDatabase,
  fixture: SetupFixture,
  input: {
    approvedAt: Date;
    paidAt: Date;
    policyNumber: string;
    sourceDraftId: string;
  },
): Promise<PolicyRecord> {
  const policy = await database.transaction(async (transaction) => {
    const [created] = await transaction
      .insert(policies)
      .values(
        policyTestInput(fixture.references, {
          accountAssignment: "book",
          amountPaid: "1050.00",
          approvedAt: input.approvedAt,
          basePremium: "1000.00",
          brokerFee: "50.00",
          commissionAmount: "100.00",
          commissionConfirmed: true,
          commissionMode: "pct",
          commissionRate: "10.0000",
          createdAt: input.approvedAt,
          insuredName: input.policyNumber,
          kayleeSplit: "book",
          netDue: "900.00",
          policyNumber: input.policyNumber,
          producerUserId: fixture.references.producerUserId,
          proposalTotal: "1050.00",
          sourceDraftId: input.sourceDraftId,
          submittedAt: input.approvedAt,
          submittedByUserId: fixture.references.producerUserId,
          updatedAt: input.approvedAt,
        }),
      )
      .returning();
    assert.ok(created);
    await transaction.execute(
      sql`select resolve_admin_direct_policy(
        ${created.id}::uuid,
        ${fixture.adminContext.principal.userId}::uuid,
        ${input.approvedAt}::timestamp with time zone
      )`,
    );
    return created;
  });
  await changeMgaPayableState(
    database,
    fixture.adminContext,
    policy.id,
    { reference: `MGA-${input.policyNumber}`, status: "paid" },
    logger,
    input.paidAt,
  );
  return requirePolicy(database, policy.id);
}

function context(
  userId: string,
  staffRole: "employee" | "producer" | null,
  capabilities: AuthorizedRequestContext["principal"]["capabilities"] = [],
): AuthorizedRequestContext {
  return { principal: { capabilities, staffRole, userActive: true, userId } };
}

async function requirePolicy(
  database: TestDatabase,
  policyId: string,
): Promise<PolicyRecord> {
  const [policy] = await database.select().from(policies).where(eq(policies.id, policyId));
  assert.ok(policy);
  return policy;
}

async function associationCount(
  database: TestDatabase,
  policyId: string,
  status: "closed" | "open",
): Promise<number> {
  const [row] = await database
    .select({ count: sql<number>`count(*)::integer` })
    .from(paySheetPolicies)
    .innerJoin(paySheets, eq(paySheets.id, paySheetPolicies.paySheetId))
    .where(and(eq(paySheetPolicies.policyId, policyId), eq(paySheets.status, status)));
  return row?.count ?? 0;
}

async function paymentState(
  database: TestDatabase,
  policyId: string,
) {
  const [payment] = await database
    .select()
    .from(mgaPayments)
    .where(eq(mgaPayments.policyId, policyId));
  assert.ok(payment);
  return payment;
}

async function deletionAuditCount(
  database: TestDatabase,
  policyId: string,
  action: "policy_restored" | "policy_soft_deleted",
): Promise<number> {
  const [row] = await database
    .select({ count: sql<number>`count(*)::integer` })
    .from(auditEvents)
    .where(and(
      eq(auditEvents.action, action),
      eq(auditEvents.entityId, policyId),
      eq(auditEvents.entityType, "policy"),
    ));
  return row?.count ?? 0;
}

async function frozenState(pool: pg.Pool, policyId: string) {
  const result = await pool.query(
    `SELECT psp.pay_sheet_id,
            psp.frozen_policy_snapshot,
            psp.frozen_rate_snapshot,
            ps.frozen_totals
       FROM pay_sheet_policies psp
       JOIN pay_sheets ps ON ps.id = psp.pay_sheet_id
      WHERE psp.policy_id = $1 AND ps.status = 'closed'
      ORDER BY psp.pay_sheet_id`,
    [policyId],
  );
  return result.rows;
}

function hashFrozenState(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function projectedPolicyIds(
  source: Awaited<ReturnType<typeof listPaySheetSources>>,
  adminContext: AuthorizedRequestContext,
): string[] {
  return source.items.flatMap((item) => {
    const projected = projectAdminPaySheetDetail(item, adminContext);
    assert.ok(projected);
    return projected.policies.map(({ policyId }) => policyId);
  });
}

async function installAuditFailure(pool: pg.Pool, action: string): Promise<void> {
  await pool.query(`
    CREATE OR REPLACE FUNCTION fail_policy_deletion_audit_for_test()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.action::text = '${action}' THEN
        RAISE EXCEPTION 'forced policy deletion audit failure' USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER fail_policy_deletion_audit_for_test_trigger
    BEFORE INSERT ON audit_events
    FOR EACH ROW EXECUTE FUNCTION fail_policy_deletion_audit_for_test();
  `);
}

async function removeAuditFailure(pool: pg.Pool): Promise<void> {
  await pool.query(`
    DROP TRIGGER IF EXISTS fail_policy_deletion_audit_for_test_trigger ON audit_events;
    DROP FUNCTION IF EXISTS fail_policy_deletion_audit_for_test();
  `);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("concurrent operation timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
