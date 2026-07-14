import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import {
  ApprovalItemStateError,
  approvePendingSubmission,
} from "../approval-queue/approve.js";
import { sendBackPendingSubmission } from "../approval-queue/send-back.js";
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
import { createOwnDraft } from "./create.js";
import { projectDraftForAuthorizedContext } from "./projection.js";
import { submitOwnDraft } from "./submit.js";
import {
  DraftSubmissionWithdrawalNotAllowedError,
  DraftSubmissionWithdrawalNotFoundError,
  withdrawOwnSubmittedDraft,
} from "./withdraw-submission.js";

test("submitted withdrawal preserves review history and serializes against approval", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for submission withdrawal test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_subwithdraw",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 8 });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const references = await createPolicyReferenceFixture(database);
        const admin = await createUser(database, {
          email: `withdrawal-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const ownerContext = staffContext(
          references.submittedByUserId,
          "employee",
        );
        const otherContext = staffContext(
          references.producerUserId,
          "producer",
        );
        const adminContext = adminContextFor(admin.id);

        const successful = await createSubmittedDraft(
          database,
          ownerContext,
          references,
          "WITHDRAW-SUCCESS",
          new Date("2026-07-14T12:00:00.000Z"),
        );
        await assert.rejects(
          withdrawOwnSubmittedDraft(
            database,
            otherContext,
            successful.draftId,
            new Date("2026-07-14T12:02:00.000Z"),
          ),
          DraftSubmissionWithdrawalNotFoundError,
        );
        const reopened = await withdrawOwnSubmittedDraft(
          database,
          ownerContext,
          successful.draftId,
          new Date("2026-07-14T12:03:00.000Z"),
        );
        assert.equal(reopened.status, "draft");
        assert.equal(reopened.linkedQueueEntryId, null);
        assert.equal(reopened.basePremium, "1000.00");
        const reopenedProjection = projectDraftForAuthorizedContext(
          reopened,
          ownerContext,
        );
        assert.ok(reopenedProjection);
        assert.equal("basePremium" in reopenedProjection, true);
        assert.equal("agencyCommissionAmount" in reopenedProjection, true);
        assert.equal("producerPayout" in reopenedProjection, false);

        const [withdrawnQueue] = await database
          .select()
          .from(approvalQueueEntries)
          .where(eq(approvalQueueEntries.id, successful.queueId));
        assert.equal(withdrawnQueue?.status, "withdrawn");
        assert.equal(withdrawnQueue?.actedByUserId, references.submittedByUserId);
        assert.deepEqual(
          withdrawnQueue?.submittedPayload,
          successful.submittedPayload,
        );
        const successAudits = await auditRowsForQueue(
          database,
          successful.queueId,
        );
        assert.equal(successAudits.length, 1);
        assert.equal(successAudits[0]?.action, "draft_submission_withdrawn");
        assert.deepEqual(successAudits[0]?.beforeSummary, {
          draftId: successful.draftId,
          status: "pending",
        });
        assert.deepEqual(successAudits[0]?.afterSummary, {
          draftId: successful.draftId,
          status: "withdrawn",
        });
        await assert.rejects(
          withdrawOwnSubmittedDraft(database, ownerContext, successful.draftId),
          DraftSubmissionWithdrawalNotAllowedError,
        );

        const auditRollback = await createSubmittedDraft(
          database,
          ownerContext,
          references,
          "WITHDRAW-AUDIT-ROLLBACK",
          new Date("2026-07-14T13:00:00.000Z"),
        );
        await installWithdrawalAuditFailure(database);
        await assert.rejects(
          withdrawOwnSubmittedDraft(
            database,
            ownerContext,
            auditRollback.draftId,
            new Date("2026-07-14T13:03:00.000Z"),
          ),
          (error: unknown) => readDatabaseErrorCode(error) === "P0001",
        );
        const [rolledBackQueue] = await database
          .select()
          .from(approvalQueueEntries)
          .where(eq(approvalQueueEntries.id, auditRollback.queueId));
        const [rolledBackDraft] = await database
          .select()
          .from(drafts)
          .where(eq(drafts.id, auditRollback.draftId));
        assert.equal(rolledBackQueue?.status, "pending");
        assert.equal(rolledBackQueue?.actedByUserId, null);
        assert.equal(rolledBackDraft?.status, "submitted");
        assert.equal(rolledBackDraft?.linkedQueueEntryId, auditRollback.queueId);
        assert.equal(
          (await auditRowsForQueue(database, auditRollback.queueId)).length,
          0,
        );
        await removeWithdrawalAuditFailure(database);

        const sentBack = await createSubmittedDraft(
          database,
          ownerContext,
          references,
          "WITHDRAW-SENT-BACK",
          new Date("2026-07-14T14:00:00.000Z"),
        );
        await sendBackPendingSubmission(
          database,
          adminContext,
          sentBack.queueId,
          { reason: "Admin already requested a correction" },
          new Date("2026-07-14T14:03:00.000Z"),
        );
        await assert.rejects(
          withdrawOwnSubmittedDraft(database, ownerContext, sentBack.draftId),
          DraftSubmissionWithdrawalNotAllowedError,
        );

        const approved = await createSubmittedDraft(
          database,
          ownerContext,
          references,
          "WITHDRAW-APPROVED",
          new Date("2026-07-14T15:00:00.000Z"),
        );
        await approvePendingSubmission(
          database,
          adminContext,
          approved.queueId,
          new Date("2026-07-14T15:03:00.000Z"),
        );
        await assert.rejects(
          withdrawOwnSubmittedDraft(database, ownerContext, approved.draftId),
          DraftSubmissionWithdrawalNotAllowedError,
        );

        const raced = await createSubmittedDraft(
          database,
          ownerContext,
          references,
          "WITHDRAW-RACE",
          new Date("2026-07-14T16:00:00.000Z"),
        );
        const withdrawalAuditsBefore = await countAuditAction(
          database,
          "draft_submission_withdrawn",
        );
        const approvalAuditsBefore = await countAuditAction(
          database,
          "policy_approved",
        );
        const raceResults = await Promise.allSettled([
          withdrawOwnSubmittedDraft(
            database,
            ownerContext,
            raced.draftId,
            new Date("2026-07-14T16:03:00.000Z"),
          ),
          approvePendingSubmission(
            database,
            adminContext,
            raced.queueId,
            new Date("2026-07-14T16:03:00.001Z"),
          ),
        ]);
        assert.equal(
          raceResults.filter(({ status }) => status === "fulfilled").length,
          1,
        );
        assert.equal(
          raceResults.filter(({ status }) => status === "rejected").length,
          1,
        );
        const rejected = raceResults.find(({ status }) => status === "rejected");
        assert.ok(rejected?.status === "rejected");
        assert.ok(
          rejected.reason instanceof DraftSubmissionWithdrawalNotAllowedError ||
            rejected.reason instanceof ApprovalItemStateError,
        );
        const [raceQueue] = await database
          .select()
          .from(approvalQueueEntries)
          .where(eq(approvalQueueEntries.id, raced.queueId));
        const [raceDraft] = await database
          .select()
          .from(drafts)
          .where(eq(drafts.id, raced.draftId));
        const racePolicies = await database
          .select()
          .from(policies)
          .where(eq(policies.sourceDraftId, raced.draftId));
        const withdrawalAuditDelta =
          (await countAuditAction(database, "draft_submission_withdrawn")) -
          withdrawalAuditsBefore;
        const approvalAuditDelta =
          (await countAuditAction(database, "policy_approved")) -
          approvalAuditsBefore;

        if (raceQueue?.status === "withdrawn") {
          assert.equal(raceDraft?.status, "draft");
          assert.equal(raceDraft?.linkedQueueEntryId, null);
          assert.equal(raceDraft?.linkedPolicyId, null);
          assert.equal(racePolicies.length, 0);
          assert.equal(withdrawalAuditDelta, 1);
          assert.equal(approvalAuditDelta, 0);
        } else {
          assert.equal(raceQueue?.status, "approved");
          assert.equal(raceDraft?.status, "approved");
          assert.equal(raceDraft?.linkedQueueEntryId, raced.queueId);
          assert.equal(raceDraft?.linkedPolicyId, racePolicies[0]?.id);
          assert.equal(racePolicies.length, 1);
          assert.equal(withdrawalAuditDelta, 0);
          assert.equal(approvalAuditDelta, 1);
        }
      } finally {
        await pool.end();
      }
    },
  );
});

async function createSubmittedDraft(
  database: Parameters<typeof createOwnDraft>[0],
  ownerContext: AuthorizedRequestContext,
  references: PolicyReferenceFixture,
  policyNumber: string,
  startedAt: Date,
) {
  const draft = await createOwnDraft(
    database,
    ownerContext,
    fullDraftInput(references, policyNumber),
    startedAt,
  );
  const result = await submitOwnDraft(
    database,
    ownerContext,
    draft.id,
    new Date(startedAt.getTime() + 60_000),
  );
  assert.equal(result.destination, "approval");
  assert.ok(result.draft.linkedQueueEntryId);
  const [queue] = await database
    .select()
    .from(approvalQueueEntries)
    .where(eq(approvalQueueEntries.id, result.draft.linkedQueueEntryId));
  assert.ok(queue);
  return {
    draftId: draft.id,
    queueId: queue.id,
    submittedPayload: queue.submittedPayload,
  };
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
    effectiveDate: "2026-07-14",
    expirationDate: "2027-07-14",
    insuredName: `Withdrawal ${policyNumber}`,
    ipfsFinanced: "no" as const,
    ipfsManual: false,
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

async function auditRowsForQueue(
  database: Parameters<typeof createOwnDraft>[0],
  queueId: string,
) {
  return database
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.action, "draft_submission_withdrawn"),
        eq(auditEvents.entityId, queueId),
      ),
    );
}

async function countAuditAction(
  database: Parameters<typeof createOwnDraft>[0],
  action: "draft_submission_withdrawn" | "policy_approved",
): Promise<number> {
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(auditEvents)
    .where(eq(auditEvents.action, action));
  return row?.count ?? 0;
}

async function installWithdrawalAuditFailure(
  database: Parameters<typeof createOwnDraft>[0],
): Promise<void> {
  await database.execute(sql`
    CREATE FUNCTION reject_submission_withdrawal_audit()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.action = 'draft_submission_withdrawn' THEN
        RAISE EXCEPTION 'forced submission withdrawal audit failure';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await database.execute(sql`
    CREATE TRIGGER reject_submission_withdrawal_audit_trigger
    BEFORE INSERT ON audit_events
    FOR EACH ROW EXECUTE FUNCTION reject_submission_withdrawal_audit()
  `);
}

async function removeWithdrawalAuditFailure(
  database: Parameters<typeof createOwnDraft>[0],
): Promise<void> {
  await database.execute(
    sql`DROP TRIGGER reject_submission_withdrawal_audit_trigger ON audit_events`,
  );
  await database.execute(sql`DROP FUNCTION reject_submission_withdrawal_audit()`);
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

function adminContextFor(userId: string): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: ["admin"],
      staffRole: null,
      userActive: true,
      userId,
    },
  };
}
