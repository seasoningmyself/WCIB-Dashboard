import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  createPolicyReferenceFixture,
  type PolicyReferenceFixture,
} from "../db/policy-test-fixture.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import {
  approvalQueueEntries,
  auditEvents,
  drafts,
  policies,
  userCapabilities,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { createOwnDraft } from "../drafts/create.js";
import { flagDraftForHelp, submitDraftForApproval } from "../policies/lifecycle.js";
import {
  ApprovalItemStateError,
  ApprovalSnapshotError,
  approveCorrectedFlaggedHelp,
  approvePendingSubmission,
  pushThroughFlaggedHelp,
} from "./approve.js";

test("approval actions preserve immutable sources and roll back atomically", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for approval action test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_approval_actions",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 6 });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const references = await createPolicyReferenceFixture(database);
        const admin = await createUser(database, {
          email: `approval-action-admin-${randomUUID()}@example.test`,
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
          "IMMUTABLE-QUEUE",
          new Date("2026-07-11T01:00:00.000Z"),
        );
        const approved = await approvePendingSubmission(
          database,
          adminContext,
          queued.queueId,
          new Date("2026-07-11T02:00:00.000Z"),
        );
        assert.equal(approved.policyNumber, "IMMUTABLE-QUEUE");
        assert.equal(approved.basePremium, "1000.00");
        assert.equal(approved.submittedByUserId, references.submittedByUserId);
        assert.equal(approved.sourceDraftId, queued.draftId);
        await assert.rejects(
          approvePendingSubmission(
            database,
            adminContext,
            queued.queueId,
            new Date("2026-07-11T03:00:00.000Z"),
          ),
          ApprovalItemStateError,
        );
        const approvedFromQueue = await database
          .select()
          .from(policies)
          .where(eq(policies.sourceDraftId, queued.draftId));
        assert.equal(approvedFromQueue.length, 1);

        const malformedDraft = await createOwnDraft(
          database,
          employeeContext,
          { insuredName: "Malformed snapshot" },
          new Date("2026-07-11T04:00:00.000Z"),
        );
        const malformedQueueId = await submitDraftForApproval(
          database,
          employeeContext,
          malformedDraft.id,
          { schemaVersion: 1 },
          new Date("2026-07-11T05:00:00.000Z"),
        );
        await assert.rejects(
          approvePendingSubmission(
            database,
            adminContext,
            malformedQueueId,
            new Date("2026-07-11T06:00:00.000Z"),
          ),
          ApprovalSnapshotError,
        );
        const [malformedQueue] = await database
          .select()
          .from(approvalQueueEntries)
          .where(eq(approvalQueueEntries.id, malformedQueueId));
        assert.equal(malformedQueue?.status, "pending");
        assert.equal(
          await policyCountForDraft(database, malformedDraft.id),
          0,
        );

        const concurrent = await createQueuedSubmission(
          database,
          employeeContext,
          references,
          "CONCURRENT-QUEUE",
          new Date("2026-07-11T07:00:00.000Z"),
        );
        const attempts = await Promise.allSettled([
          approvePendingSubmission(
            database,
            adminContext,
            concurrent.queueId,
            new Date("2026-07-11T08:00:00.000Z"),
          ),
          approvePendingSubmission(
            database,
            adminContext,
            concurrent.queueId,
            new Date("2026-07-11T08:00:00.001Z"),
          ),
        ]);
        assert.equal(
          attempts.filter(({ status }) => status === "fulfilled").length,
          1,
        );
        assert.equal(
          attempts.filter(({ status }) => status === "rejected").length,
          1,
        );
        assert.equal(await policyCountForDraft(database, concurrent.draftId), 1);

        const auditRollback = await createQueuedSubmission(
          database,
          employeeContext,
          references,
          "AUDIT-ROLLBACK",
          new Date("2026-07-11T09:00:00.000Z"),
        );
        await database.execute(sql`
          CREATE FUNCTION reject_parent_d_approval_audit()
          RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.action = 'policy_approved' THEN
              RAISE EXCEPTION 'forced approval audit failure';
            END IF;
            RETURN NEW;
          END;
          $$
        `);
        await database.execute(sql`
          CREATE TRIGGER reject_parent_d_approval_audit_trigger
          BEFORE INSERT ON audit_events
          FOR EACH ROW EXECUTE FUNCTION reject_parent_d_approval_audit()
        `);
        await assert.rejects(
          approvePendingSubmission(
            database,
            adminContext,
            auditRollback.queueId,
            new Date("2026-07-11T10:00:00.000Z"),
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
        assert.equal(rolledBackDraft?.status, "submitted");
        assert.equal(await policyCountForDraft(database, auditRollback.draftId), 0);
        await database.execute(
          sql`DROP TRIGGER reject_parent_d_approval_audit_trigger ON audit_events`,
        );
        await database.execute(
          sql`DROP FUNCTION reject_parent_d_approval_audit()`,
        );

        const pushedDraft = await createFlaggedDraft(
          database,
          employeeContext,
          references,
          "FLAG-PUSH",
          "Original Push Name",
          new Date("2026-07-11T11:00:00.000Z"),
        );
        const pushedPolicy = await pushThroughFlaggedHelp(
          database,
          adminContext,
          pushedDraft.id,
          new Date("2026-07-11T12:00:00.000Z"),
        );
        assert.equal(pushedPolicy.insuredName, "Original Push Name");
        assert.equal(pushedPolicy.sourceDraftId, pushedDraft.id);

        const fixedDraft = await createFlaggedDraft(
          database,
          employeeContext,
          references,
          "FLAG-FIX",
          "Original Fix Name",
          new Date("2026-07-11T13:00:00.000Z"),
        );
        const fixedPolicy = await approveCorrectedFlaggedHelp(
          database,
          adminContext,
          fixedDraft.id,
          { insuredName: "Corrected Fix Name" },
          new Date("2026-07-11T14:00:00.000Z"),
        );
        assert.equal(fixedPolicy.insuredName, "Corrected Fix Name");
        const [preservedSource] = await database
          .select()
          .from(drafts)
          .where(eq(drafts.id, fixedDraft.id));
        assert.equal(preservedSource?.insuredName, "Original Fix Name");
        assert.equal(preservedSource?.status, "approved");
        assert.equal(preservedSource?.linkedPolicyId, fixedPolicy.id);

        const lifecycleAudits = await database
          .select({ action: auditEvents.action, entityId: auditEvents.entityId })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.actorUserId, admin.id),
              sql`${auditEvents.action} in ('policy_approved', 'admin_policy_submitted')`,
            ),
          );
        assert.equal(
          lifecycleAudits.filter(({ action }) => action === "policy_approved")
            .length,
          2,
        );
        assert.equal(
          lifecycleAudits.filter(
            ({ action }) => action === "admin_policy_submitted",
          ).length,
          2,
        );
      } finally {
        await pool.end();
      }
    },
  );
});

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
    fullDraftInput(references, policyNumber, "Queued Insured"),
    startedAt,
  );
  const queueId = await submitDraftForApproval(
    database,
    employeeContext,
    draft.id,
    validSnapshot(references, policyNumber, "Queued Insured"),
    new Date(startedAt.getTime() + 60_000),
  );
  return { draftId: draft.id, queueId };
}

async function createFlaggedDraft(
  database: Parameters<typeof createOwnDraft>[0],
  employeeContext: AuthorizedRequestContext,
  references: PolicyReferenceFixture,
  policyNumber: string,
  insuredName: string,
  startedAt: Date,
) {
  const draft = await createOwnDraft(
    database,
    employeeContext,
    fullDraftInput(references, policyNumber, insuredName),
    startedAt,
  );
  await flagDraftForHelp(
    database,
    employeeContext,
    draft.id,
    "Need admin review",
    new Date(startedAt.getTime() + 60_000),
  );
  return draft;
}

function fullDraftInput(
  references: PolicyReferenceFixture,
  policyNumber: string,
  insuredName: string,
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
    insuredName,
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

function validSnapshot(
  references: PolicyReferenceFixture,
  policyNumber: string,
  insuredName: string,
) {
  return {
    accountAssignment: "book" as const,
    amountPaid: "250.00",
    basePremium: "1000.00",
    brokerFee: "20.00",
    carrierId: references.carrierId,
    commissionAmount: "125.00",
    commissionConfirmed: true,
    commissionMode: "pct" as const,
    commissionRate: "12.5000",
    companyName: null,
    depositOption: "250.00",
    effectiveDate: "2026-07-11",
    expirationDate: "2027-07-11",
    financeBalance: "780.00",
    financeContact: null,
    financeMeta: null,
    financeReference: null,
    insuredName,
    invoiceNumber: null,
    ipfsFinanced: "no" as const,
    ipfsManual: false,
    ipfsReturning: null,
    kayleeSplit: "book" as const,
    mgaFee: "10.00",
    mgaId: references.mgaId,
    netDue: "105.00",
    notes: null,
    officeLocationId: references.officeLocationId,
    paymentMode: "deposit" as const,
    policyNumber,
    policyTypeId: references.policyTypeId,
    producerUserId: references.producerUserId,
    proposalTotal: "1030.00",
    schemaVersion: 1,
    taxes: "0.00",
    transactionNotes: null,
    transactionType: "New",
  };
}

async function policyCountForDraft(
  database: Parameters<typeof createOwnDraft>[0],
  draftId: string,
): Promise<number> {
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(policies)
    .where(eq(policies.sourceDraftId, draftId));
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
