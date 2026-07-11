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
  approvalQueueEntries,
  auditEvents,
  drafts,
  staffProfiles,
  userCapabilities,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { createOwnDraft } from "../drafts/create.js";
import {
  DRAFT_FINANCIAL_FIELDS,
  projectDraftForAuthorizedContext,
} from "../drafts/projection.js";
import { flagDraftForHelp, submitDraftForApproval } from "../policies/lifecycle.js";
import { ApprovalItemStateError } from "./approve.js";
import {
  sendBackFlaggedHelp,
  sendBackPendingSubmission,
} from "./send-back.js";

test("pending and flagged send-back paths are separate, atomic, and audited", async () => {
  const sourceDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(sourceDatabaseUrl, "DATABASE_URL is required for send-back test");

  await withDisposableMigratedDatabase(
    sourceDatabaseUrl,
    "wcib_send_back",
    async (databaseUrl) => {
      const pool = new pg.Pool({ connectionString: databaseUrl, max: 6 });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const admin = await createUser(database, {
          email: `send-back-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        const employee = await createUser(database, {
          email: `send-back-employee-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        const producer = await createUser(database, {
          email: `send-back-producer-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        await database.insert(staffProfiles).values([
          {
            displayName: "Send Back Employee",
            role: "employee",
            userId: employee.id,
          },
          {
            displayName: "Send Back Producer",
            role: "producer",
            userId: producer.id,
          },
        ]);
        const adminContext = context(admin.id, {
          capabilities: ["admin"],
        });
        const employeeContext = context(employee.id, {
          staffRole: "employee",
        });
        const producerContext = context(producer.id, {
          staffRole: "producer",
        });

        const pending = await createQueuedDraft(
          database,
          employeeContext,
          "PENDING-SEND-BACK",
          new Date("2026-07-11T01:00:00.000Z"),
        );
        const pendingResult = await sendBackPendingSubmission(
          database,
          adminContext,
          pending.queueId,
          { reason: "  Correct the carrier  " },
          new Date("2026-07-11T02:00:00.000Z"),
        );
        assert.equal(pendingResult.status, "sent_back");
        assert.equal(pendingResult.reason, "Correct the carrier");
        assert.equal(pendingResult.actedByUserId, admin.id);
        const [pendingDraft] = await database
          .select()
          .from(drafts)
          .where(eq(drafts.id, pending.draftId));
        assert.equal(pendingDraft?.status, "sent_back");
        assert.equal(pendingDraft?.sentBackReason, "Correct the carrier");
        assert.equal(pendingDraft?.sentBackByUserId, admin.id);
        assertStaffProjectionHasNoStoredFinancials(
          pendingDraft,
          employeeContext,
        );
        assert.equal(
          await resolutionAuditCount(
            database,
            admin.id,
            "approval_queue_entry",
            pending.queueId,
          ),
          1,
        );
        await assert.rejects(
          sendBackPendingSubmission(
            database,
            adminContext,
            pending.queueId,
            { reason: "Replay" },
            new Date("2026-07-11T03:00:00.000Z"),
          ),
          ApprovalItemStateError,
        );

        const flagged = await createFlaggedDraft(
          database,
          producerContext,
          "FLAGGED-SEND-BACK",
          new Date("2026-07-11T04:00:00.000Z"),
        );
        const flaggedResult = await sendBackFlaggedHelp(
          database,
          adminContext,
          flagged.id,
          { reason: "  Complete the finance reference  " },
          new Date("2026-07-11T05:00:00.000Z"),
        );
        assert.equal(flaggedResult.status, "sent_back");
        assert.equal(flaggedResult.flagReason, null);
        assert.equal(
          flaggedResult.sentBackReason,
          "Complete the finance reference",
        );
        assert.equal(flaggedResult.sentBackByUserId, admin.id);
        assertStaffProjectionHasNoStoredFinancials(
          flaggedResult,
          producerContext,
        );
        assert.equal(
          await resolutionAuditCount(
            database,
            admin.id,
            "draft",
            flagged.id,
          ),
          1,
        );
        const syntheticQueues = await database
          .select()
          .from(approvalQueueEntries)
          .where(eq(approvalQueueEntries.draftId, flagged.id));
        assert.deepEqual(syntheticQueues, []);
        await assert.rejects(
          sendBackFlaggedHelp(
            database,
            adminContext,
            flagged.id,
            { reason: "Replay" },
            new Date("2026-07-11T06:00:00.000Z"),
          ),
          ApprovalItemStateError,
        );

        const denied = await createQueuedDraft(
          database,
          employeeContext,
          "DENIED-SEND-BACK",
          new Date("2026-07-11T07:00:00.000Z"),
        );
        await assert.rejects(
          sendBackPendingSubmission(
            database,
            employeeContext,
            denied.queueId,
            { reason: "Forged admin" },
            new Date("2026-07-11T08:00:00.000Z"),
          ),
        );
        const [stillPending] = await database
          .select()
          .from(approvalQueueEntries)
          .where(eq(approvalQueueEntries.id, denied.queueId));
        assert.equal(stillPending?.status, "pending");

        const concurrent = await createFlaggedDraft(
          database,
          employeeContext,
          "CONCURRENT-SEND-BACK",
          new Date("2026-07-11T09:00:00.000Z"),
        );
        const concurrentResults = await Promise.allSettled([
          sendBackFlaggedHelp(
            database,
            adminContext,
            concurrent.id,
            { reason: "First admin action" },
            new Date("2026-07-11T10:00:00.000Z"),
          ),
          sendBackFlaggedHelp(
            database,
            adminContext,
            concurrent.id,
            { reason: "Second admin action" },
            new Date("2026-07-11T10:00:00.001Z"),
          ),
        ]);
        assert.equal(
          concurrentResults.filter(({ status }) => status === "fulfilled")
            .length,
          1,
        );
        assert.equal(
          concurrentResults.filter(({ status }) => status === "rejected")
            .length,
          1,
        );
        assert.equal(
          await resolutionAuditCount(
            database,
            admin.id,
            "draft",
            concurrent.id,
          ),
          1,
        );

        const pendingRollback = await createQueuedDraft(
          database,
          employeeContext,
          "PENDING-AUDIT-ROLLBACK",
          new Date("2026-07-11T11:00:00.000Z"),
        );
        const flaggedRollback = await createFlaggedDraft(
          database,
          producerContext,
          "FLAGGED-AUDIT-ROLLBACK",
          new Date("2026-07-11T13:00:00.000Z"),
        );
        await database.execute(sql`
          CREATE FUNCTION reject_parent_d_send_back_audit()
          RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.action = 'draft_sent_back' THEN
              RAISE EXCEPTION 'forced send-back audit failure';
            END IF;
            RETURN NEW;
          END;
          $$
        `);
        await database.execute(sql`
          CREATE TRIGGER reject_parent_d_send_back_audit_trigger
          BEFORE INSERT ON audit_events
          FOR EACH ROW EXECUTE FUNCTION reject_parent_d_send_back_audit()
        `);
        await assert.rejects(
          sendBackPendingSubmission(
            database,
            adminContext,
            pendingRollback.queueId,
            { reason: "Must roll back" },
            new Date("2026-07-11T15:00:00.000Z"),
          ),
          (error: unknown) => readDatabaseErrorCode(error) === "P0001",
        );
        await assert.rejects(
          sendBackFlaggedHelp(
            database,
            adminContext,
            flaggedRollback.id,
            { reason: "Must roll back" },
            new Date("2026-07-11T15:00:00.000Z"),
          ),
          (error: unknown) => readDatabaseErrorCode(error) === "P0001",
        );
        const [rolledBackQueue] = await database
          .select()
          .from(approvalQueueEntries)
          .where(eq(approvalQueueEntries.id, pendingRollback.queueId));
        const [rolledBackPendingDraft] = await database
          .select()
          .from(drafts)
          .where(eq(drafts.id, pendingRollback.draftId));
        const [rolledBackFlaggedDraft] = await database
          .select()
          .from(drafts)
          .where(eq(drafts.id, flaggedRollback.id));
        assert.equal(rolledBackQueue?.status, "pending");
        assert.equal(rolledBackQueue?.reason, null);
        assert.equal(rolledBackPendingDraft?.status, "submitted");
        assert.equal(rolledBackPendingDraft?.sentBackReason, null);
        assert.equal(rolledBackFlaggedDraft?.status, "flagged");
        assert.equal(rolledBackFlaggedDraft?.flagReason, "Need admin help");
        assert.equal(rolledBackFlaggedDraft?.sentBackReason, null);
      } finally {
        await pool.end();
      }
    },
  );
});

async function createQueuedDraft(
  database: Parameters<typeof createOwnDraft>[0],
  ownerContext: AuthorizedRequestContext,
  policyNumber: string,
  startedAt: Date,
) {
  const draft = await createFinancialDraft(
    database,
    ownerContext,
    policyNumber,
    startedAt,
  );
  const queueId = await submitDraftForApproval(
    database,
    ownerContext,
    draft.id,
    {
      basePremium: "1000.00",
      insuredName: "Send Back Insured",
      ipfsFinanced: "yes",
      schemaVersion: 1,
    },
    new Date(startedAt.getTime() + 60_000),
  );
  return { draftId: draft.id, queueId };
}

async function createFlaggedDraft(
  database: Parameters<typeof createOwnDraft>[0],
  ownerContext: AuthorizedRequestContext,
  policyNumber: string,
  startedAt: Date,
) {
  const draft = await createFinancialDraft(
    database,
    ownerContext,
    policyNumber,
    startedAt,
  );
  await flagDraftForHelp(
    database,
    ownerContext,
    draft.id,
    "Need admin help",
    new Date(startedAt.getTime() + 60_000),
  );
  return draft;
}

function createFinancialDraft(
  database: Parameters<typeof createOwnDraft>[0],
  ownerContext: AuthorizedRequestContext,
  policyNumber: string,
  createdAt: Date,
) {
  return createOwnDraft(
    database,
    ownerContext,
    {
      accountAssignment: "none",
      amountPaid: "300.00",
      basePremium: "1000.00",
      brokerFee: "50.00",
      commissionConfirmed: true,
      commissionMode: "pct",
      commissionRate: "12.5000",
      depositOption: "300.00",
      effectiveDate: "2026-07-01",
      expirationDate: "2027-07-01",
      financeContact: {
        address: "100 Main St, Portland, OR 97201",
        email: "insured@example.test",
        mobile: "555-555-5555",
      },
      financeReference: "FIN-SEND-BACK",
      insuredName: "Send Back Insured",
      ipfsFinanced: "yes",
      ipfsReturning: "new",
      mgaFee: "25.00",
      paymentMode: "deposit",
      policyNumber,
      proposalTotal: "1080.00",
      taxes: "5.00",
      transactionType: "New",
    },
    createdAt,
  );
}

function assertStaffProjectionHasNoStoredFinancials(
  draft: Awaited<ReturnType<typeof createOwnDraft>> | undefined,
  ownerContext: AuthorizedRequestContext,
): void {
  assert.ok(draft);
  const projection = projectDraftForAuthorizedContext(draft, ownerContext);
  assert.ok(projection);
  for (const field of [...DRAFT_FINANCIAL_FIELDS, "agencyCommissionAmount"]) {
    assert.equal(field in projection, false, field);
  }
}

async function resolutionAuditCount(
  database: Parameters<typeof createOwnDraft>[0],
  actorUserId: string,
  entityType: "approval_queue_entry" | "draft",
  entityId: string,
): Promise<number> {
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.actorUserId, actorUserId),
        eq(auditEvents.action, "draft_sent_back"),
        eq(auditEvents.entityType, entityType),
        eq(auditEvents.entityId, entityId),
      ),
    );
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
