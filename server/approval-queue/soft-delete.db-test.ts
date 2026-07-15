import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import {
  createPolicyReferenceFixture,
  type PolicyReferenceFixture,
} from "../db/policy-test-fixture.js";
import {
  approvalQueueEntries,
  auditEvents,
  drafts,
  policies,
  userCapabilities,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { createOwnDraft } from "../drafts/create.js";
import { listOwnDrafts } from "../drafts/list.js";
import { listOwnMyItemSources } from "../drafts/my-items.js";
import type { AppLogger } from "../logging/logger.js";
import { softDeletePolicy } from "../policies/soft-delete.js";
import {
  flagDraftForHelp,
  PolicyLifecycleAccessError,
  submitDraftForApproval,
} from "../policies/lifecycle.js";
import { approvePendingSubmission } from "./approve.js";
import { listApprovalWork } from "./list.js";
import {
  ApprovalWorkDeletionStateError,
  listDeletedApprovalWork,
  restoreApprovalWork,
  softDeleteApprovalWork,
} from "./soft-delete.js";

const logger: AppLogger = {
  error() {},
  info() {},
  warn() {},
};

test("approval work soft-delete is recoverable, isolated, audited, and race-safe", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for approval deletion test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_approval_delete",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 12 });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const references = await createPolicyReferenceFixture(database);
        const admin = await createUser(database, {
          email: `approval-delete-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const adminContext = context(admin.id, { capabilities: ["admin"] });
        const employeeContext = context(references.submittedByUserId, {
          staffRole: "employee",
        });

        const queued = await createQueuedSubmission(
          database,
          employeeContext,
          references,
          "M2-RECOVERABLE",
          new Date("2026-07-14T01:00:00.000Z"),
        );
        const beforeQueue = await requireQueue(database, queued.queueId);
        const beforeDraft = await requireDraft(database, queued.draftId);
        const deleted = await softDeleteApprovalWork(
          database,
          adminContext,
          "submission",
          queued.queueId,
          {
            expectedUpdatedAt: beforeQueue.updatedAt,
            reason: "Duplicate pending submission",
          },
          logger,
          new Date("2026-07-14T03:00:00.000Z"),
        );
        assert.equal(deleted.changed, true);
        const deletedQueue = await requireQueue(database, queued.queueId);
        const deletedDraft = await requireDraft(database, queued.draftId);
        assert.equal(deletedQueue.status, "pending");
        assert.equal(deletedDraft.status, "submitted");
        assert.deepEqual(deletedQueue.submittedPayload, beforeQueue.submittedPayload);
        assert.equal(deletedQueue.deletedByUserId, admin.id);
        assert.equal(deletedDraft.deletedByUserId, admin.id);
        assert.equal(deletedQueue.deleteReason, "Duplicate pending submission");
        assert.equal(deletedDraft.deleteReason, "Duplicate pending submission");

        const activeWork = await listApprovalWork(database, adminContext, {});
        assert.equal(
          activeWork.submissions.some(({ entry }) => entry.id === queued.queueId),
          false,
        );
        assert.equal(
          (await listOwnDrafts(database, employeeContext, {})).some(
            ({ id }) => id === queued.draftId,
          ),
          false,
        );
        assert.equal(
          (await listOwnMyItemSources(database, employeeContext)).some(
            ({ id }) => id === queued.draftId,
          ),
          false,
        );
        assert.equal(
          (await listDeletedApprovalWork(database, adminContext)).some(
            (item) => item.kind === "submission" && item.entry.id === queued.queueId,
          ),
          true,
        );
        assert.equal(
          await auditCount(
            database,
            queued.queueId,
            "approval_work_soft_deleted",
          ),
          1,
        );

        const repeatedDelete = await softDeleteApprovalWork(
          database,
          adminContext,
          "submission",
          queued.queueId,
          {
            expectedUpdatedAt: beforeQueue.updatedAt,
            reason: "Ignored idempotent retry",
          },
          logger,
          new Date("2026-07-14T03:30:00.000Z"),
        );
        assert.equal(repeatedDelete.changed, false);
        assert.equal(
          await auditCount(
            database,
            queued.queueId,
            "approval_work_soft_deleted",
          ),
          1,
        );

        const restored = await restoreApprovalWork(
          database,
          adminContext,
          "submission",
          queued.queueId,
          { expectedUpdatedAt: deletedQueue.updatedAt },
          logger,
          new Date(deletedQueue.updatedAt.getTime() + 60_000),
        );
        assert.equal(restored.changed, true);
        const restoredQueue = await requireQueue(database, queued.queueId);
        const restoredDraft = await requireDraft(database, queued.draftId);
        assert.equal(restoredQueue.deletedAt, null);
        assert.equal(restoredDraft.deletedAt, null);
        assert.equal(restoredQueue.status, "pending");
        assert.equal(restoredDraft.status, "submitted");
        assert.deepEqual(restoredQueue.submittedPayload, beforeQueue.submittedPayload);
        assert.equal(
          await auditCount(database, queued.queueId, "approval_work_restored"),
          1,
        );

        const flagged = await createFlaggedDraft(
          database,
          employeeContext,
          references,
          "M2-FLAGGED",
          new Date("2026-07-14T05:00:00.000Z"),
        );
        const flaggedBefore = await requireDraft(database, flagged.id);
        await softDeleteApprovalWork(
          database,
          adminContext,
          "help",
          flagged.id,
          {
            expectedUpdatedAt: flaggedBefore.lastEditedAt,
            reason: "Duplicate help request",
          },
          logger,
          new Date("2026-07-14T07:00:00.000Z"),
        );
        assert.equal(
          (await listApprovalWork(database, adminContext, {})).helpRequests.some(
            ({ draft }) => draft.id === flagged.id,
          ),
          false,
        );
        const flaggedDeleted = await requireDraft(database, flagged.id);
        await restoreApprovalWork(
          database,
          adminContext,
          "help",
          flagged.id,
          { expectedUpdatedAt: flaggedDeleted.lastEditedAt },
          logger,
          new Date("2026-07-14T08:00:00.000Z"),
        );
        assert.equal((await requireDraft(database, flagged.id)).status, "flagged");

        await assert.rejects(
          softDeleteApprovalWork(
            database,
            employeeContext,
            "submission",
            queued.queueId,
            {
              expectedUpdatedAt: restoredQueue.updatedAt,
              reason: "Employee must not delete",
            },
            logger,
            new Date("2026-07-14T09:00:00.000Z"),
          ),
          PolicyLifecycleAccessError,
        );

        await proveDirectMutationGuard(
          pool,
          database,
          admin.id,
          queued.queueId,
        );
        await proveAuditRollback(
          pool,
          database,
          adminContext,
          employeeContext,
          references,
        );
        await proveApprovedPolicyIsolation(
          database,
          adminContext,
          employeeContext,
          references,
        );
        await proveDeleteApproveRace(
          database,
          adminContext,
          employeeContext,
          references,
        );
      } finally {
        await pool.end();
      }
    },
  );
});

async function proveDirectMutationGuard(
  pool: pg.Pool,
  database: Parameters<typeof createOwnDraft>[0],
  adminId: string,
  queueId: string,
): Promise<void> {
  const runtimeRole = `wcib_m2_runtime_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`CREATE ROLE "${runtimeRole}" NOLOGIN`);
  try {
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${runtimeRole}"`);
    await pool.query(
      `GRANT SELECT, UPDATE ON approval_queue_entries TO "${runtimeRole}"`,
    );
    await assert.rejects(
      database.transaction(async (transaction) => {
        await transaction.execute(sql.raw(`SET LOCAL ROLE "${runtimeRole}"`));
        await transaction.execute(sql`
          select set_config(
            'wcib.approval_work_deletion_context',
            'delete',
            true
          )
        `);
        await transaction
          .update(approvalQueueEntries)
          .set({
            deleteReason: "Spoofed delete context",
            deletedAt: new Date("2026-07-14T09:30:00.000Z"),
            deletedByUserId: adminId,
          })
          .where(eq(approvalQueueEntries.id, queueId));
      }),
      (error: unknown) => readDatabaseErrorCode(error) === "55000",
    );
  } finally {
    await pool.query(`DROP OWNED BY "${runtimeRole}"`);
    await pool.query(`DROP ROLE IF EXISTS "${runtimeRole}"`);
  }
}

async function proveAuditRollback(
  pool: pg.Pool,
  database: Parameters<typeof createOwnDraft>[0],
  adminContext: AuthorizedRequestContext,
  employeeContext: AuthorizedRequestContext,
  references: PolicyReferenceFixture,
): Promise<void> {
  const queued = await createQueuedSubmission(
    database,
    employeeContext,
    references,
    "M2-AUDIT-ROLLBACK",
    new Date("2026-07-14T10:00:00.000Z"),
  );
  const before = await requireQueue(database, queued.queueId);
  await installApprovalWorkAuditFailure(pool, "approval_work_soft_deleted");
  try {
    await assert.rejects(
      softDeleteApprovalWork(
        database,
        adminContext,
        "submission",
        queued.queueId,
        { expectedUpdatedAt: before.updatedAt, reason: "Must roll back" },
        logger,
        new Date("2026-07-14T12:00:00.000Z"),
      ),
      (error: unknown) => readDatabaseErrorCode(error) === "P0001",
    );
    assert.equal((await requireQueue(database, queued.queueId)).deletedAt, null);
    assert.equal((await requireDraft(database, queued.draftId)).deletedAt, null);
    assert.equal(
      await auditCount(
        database,
        queued.queueId,
        "approval_work_soft_deleted",
      ),
      0,
    );
  } finally {
    await removeApprovalWorkAuditFailure(pool);
  }

  await softDeleteApprovalWork(
    database,
    adminContext,
    "submission",
    queued.queueId,
    { expectedUpdatedAt: before.updatedAt, reason: "Restore rollback proof" },
    logger,
    new Date("2026-07-14T13:00:00.000Z"),
  );
  const deletedQueue = await requireQueue(database, queued.queueId);
  await installApprovalWorkAuditFailure(pool, "approval_work_restored");
  try {
    await assert.rejects(
      restoreApprovalWork(
        database,
        adminContext,
        "submission",
        queued.queueId,
        { expectedUpdatedAt: deletedQueue.updatedAt },
        logger,
        new Date(deletedQueue.updatedAt.getTime() + 60_000),
      ),
      (error: unknown) => readDatabaseErrorCode(error) === "P0001",
    );
    assert.notEqual(
      (await requireQueue(database, queued.queueId)).deletedAt,
      null,
    );
    assert.notEqual(
      (await requireDraft(database, queued.draftId)).deletedAt,
      null,
    );
    assert.equal(
      await auditCount(database, queued.queueId, "approval_work_restored"),
      0,
    );
  } finally {
    await removeApprovalWorkAuditFailure(pool);
  }
}

async function installApprovalWorkAuditFailure(
  pool: pg.Pool,
  action: "approval_work_soft_deleted" | "approval_work_restored",
): Promise<void> {
  await pool.query(`
    CREATE FUNCTION reject_m2_deletion_audit()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.action = '${action}' THEN
        RAISE EXCEPTION 'forced M2 audit failure';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await pool.query(`
    CREATE TRIGGER reject_m2_deletion_audit_trigger
    BEFORE INSERT ON audit_events
    FOR EACH ROW EXECUTE FUNCTION reject_m2_deletion_audit()
  `);
}

async function removeApprovalWorkAuditFailure(pool: pg.Pool): Promise<void> {
  await pool.query(
    "DROP TRIGGER reject_m2_deletion_audit_trigger ON audit_events",
  );
  await pool.query("DROP FUNCTION reject_m2_deletion_audit()");
}

async function proveApprovedPolicyIsolation(
  database: Parameters<typeof createOwnDraft>[0],
  adminContext: AuthorizedRequestContext,
  employeeContext: AuthorizedRequestContext,
  references: PolicyReferenceFixture,
): Promise<void> {
  const queued = await createQueuedSubmission(
    database,
    employeeContext,
    references,
    "M2-APPROVED-REJECT",
    new Date("2026-07-13T01:00:00.000Z"),
  );
  const policy = await approvePendingSubmission(
    database,
    adminContext,
    queued.queueId,
    new Date("2026-07-13T03:00:00.000Z"),
  );
  const approvedQueue = await requireQueue(database, queued.queueId);
  await assert.rejects(
    softDeleteApprovalWork(
      database,
      adminContext,
      "submission",
      queued.queueId,
      {
        expectedUpdatedAt: approvedQueue.updatedAt,
        reason: "Approved work cannot be deleted",
      },
      logger,
      new Date("2026-07-13T04:00:00.000Z"),
    ),
    ApprovalWorkDeletionStateError,
  );
  assert.equal((await requireQueue(database, queued.queueId)).deletedAt, null);
  assert.equal((await requireDraft(database, queued.draftId)).deletedAt, null);

  await softDeletePolicy(
    database,
    adminContext,
    policy.id,
    { expectedUpdatedAt: policy.updatedAt, reason: "M1 isolation proof" },
    logger,
    new Date("2026-07-13T05:00:00.000Z"),
  );
  assert.equal((await requireQueue(database, queued.queueId)).deletedAt, null);
  assert.equal((await requireDraft(database, queued.draftId)).deletedAt, null);
}

async function proveDeleteApproveRace(
  database: Parameters<typeof createOwnDraft>[0],
  adminContext: AuthorizedRequestContext,
  employeeContext: AuthorizedRequestContext,
  references: PolicyReferenceFixture,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const startedAt = new Date(
      Date.parse("2026-07-13T12:00:00.000Z") + attempt * 3_600_000,
    );
    const queued = await createQueuedSubmission(
      database,
      employeeContext,
      references,
      `M2-RACE-${attempt}`,
      startedAt,
    );
    const queue = await requireQueue(database, queued.queueId);
    const raced = await Promise.allSettled([
      softDeleteApprovalWork(
        database,
        adminContext,
        "submission",
        queued.queueId,
        { expectedUpdatedAt: queue.updatedAt, reason: "Concurrent delete" },
        logger,
        new Date(startedAt.getTime() + 120_000),
      ),
      approvePendingSubmission(
        database,
        adminContext,
        queued.queueId,
        new Date(startedAt.getTime() + 120_001),
      ),
    ]);
    assert.equal(raced.filter(({ status }) => status === "fulfilled").length, 1);
    assert.equal(raced.filter(({ status }) => status === "rejected").length, 1);

    const finalQueue = await requireQueue(database, queued.queueId);
    const finalDraft = await requireDraft(database, queued.draftId);
    const [policyCount] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(policies)
      .where(eq(policies.sourceDraftId, queued.draftId));
    if (raced[0]?.status === "fulfilled") {
      assert.notEqual(finalQueue.deletedAt, null);
      assert.notEqual(finalDraft.deletedAt, null);
      assert.equal(finalQueue.status, "pending");
      assert.equal(finalDraft.status, "submitted");
      assert.equal(policyCount?.count, 0);
    } else {
      assert.equal(finalQueue.deletedAt, null);
      assert.equal(finalDraft.deletedAt, null);
      assert.equal(finalQueue.status, "approved");
      assert.equal(finalDraft.status, "approved");
      assert.equal(policyCount?.count, 1);
    }
  }
}

async function createQueuedSubmission(
  database: Parameters<typeof createOwnDraft>[0],
  employeeContext: AuthorizedRequestContext,
  references: PolicyReferenceFixture,
  policyNumber: string,
  startedAt: Date,
) {
  const draft = await createOwnDraft(
    database,
    employeeContext,
    fullDraftInput(references, policyNumber),
    startedAt,
  );
  const queueId = await submitDraftForApproval(
    database,
    employeeContext,
    draft.id,
    validSnapshot(references, policyNumber),
    new Date(startedAt.getTime() + 60_000),
  );
  return { draftId: draft.id, queueId };
}

async function createFlaggedDraft(
  database: Parameters<typeof createOwnDraft>[0],
  employeeContext: AuthorizedRequestContext,
  references: PolicyReferenceFixture,
  policyNumber: string,
  startedAt: Date,
) {
  const draft = await createOwnDraft(
    database,
    employeeContext,
    fullDraftInput(references, policyNumber),
    startedAt,
  );
  await flagDraftForHelp(
    database,
    employeeContext,
    draft.id,
    "Need admin help",
    new Date(startedAt.getTime() + 60_000),
  );
  return draft;
}

function fullDraftInput(
  references: PolicyReferenceFixture,
  policyNumber: string,
) {
  return {
    accountAssignment: "book" as const,
    amountPaid: "250.00",
    basePremium: "1000.00",
    brokerFee: "20.00",
    carrierId: references.carrierId,
    commissionConfirmed: true,
    commissionMode: "pct" as const,
    commissionRate: "12.5000",
    depositOption: "250.00",
    effectiveDate: "2026-07-11",
    expirationDate: "2027-07-11",
    insuredName: `Insured ${policyNumber}`,
    ipfsFinanced: "no" as const,
    mgaFee: "10.00",
    mgaId: references.mgaId,
    officeLocationId: references.officeLocationId,
    paymentMode: "deposit" as const,
    policyNumber,
    policyTypeId: references.policyTypeId,
    producerUserId: references.producerUserId,
    proposalTotal: "1030.00",
    taxes: "0.00",
    transactionType: "New",
  };
}

function validSnapshot(
  references: PolicyReferenceFixture,
  policyNumber: string,
) {
  return {
    ...fullDraftInput(references, policyNumber),
    commissionAmount: "125.00",
    companyName: null,
    financeBalance: "780.00",
    financeContact: null,
    financeMeta: null,
    financeReference: null,
    invoiceNumber: null,
    ipfsManual: false,
    ipfsReturning: null,
    kayleeSplit: "book" as const,
    netDue: "105.00",
    notes: null,
    schemaVersion: 1,
    transactionNotes: null,
  };
}

async function requireQueue(
  database: Parameters<typeof createOwnDraft>[0],
  queueId: string,
) {
  const [row] = await database
    .select()
    .from(approvalQueueEntries)
    .where(eq(approvalQueueEntries.id, queueId));
  assert.ok(row);
  return row;
}

async function requireDraft(
  database: Parameters<typeof createOwnDraft>[0],
  draftId: string,
) {
  const [row] = await database
    .select()
    .from(drafts)
    .where(eq(drafts.id, draftId));
  assert.ok(row);
  return row;
}

async function auditCount(
  database: Parameters<typeof createOwnDraft>[0],
  entityId: string,
  action: "approval_work_soft_deleted" | "approval_work_restored",
): Promise<number> {
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(auditEvents)
    .where(and(eq(auditEvents.entityId, entityId), eq(auditEvents.action, action)));
  return row?.count ?? 0;
}

function context(
  userId: string,
  input: Partial<AuthorizedRequestContext["principal"]> = {},
): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: [],
      staffRole: null,
      userActive: true,
      userId,
      ...input,
    },
  };
}
