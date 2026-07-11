import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import {
  approveQueuedPolicyInTransaction,
  flagDraftForHelp,
  sendBackQueuedDraft,
  submitAdminPolicyDirectInTransaction,
  submitDraftForApproval,
  type PolicyLifecycleInput,
} from "../policies/lifecycle.js";
import { readDatabaseErrorCode } from "./error-code.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
  type PolicyReferenceFixture,
} from "./policy-test-fixture.js";
import {
  approvalQueueEntries,
  auditEvents,
  drafts,
  policies,
  userCapabilities,
} from "./schema.js";
import * as databaseSchema from "./schema.js";

let savepointSequence = 0;

async function expectDatabaseError(
  client: pg.PoolClient,
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  const savepoint = `expected_lifecycle_error_${savepointSequence++}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await assert.rejects(
      action,
      (error: unknown) => readDatabaseErrorCode(error) === code,
    );
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    await client.query("SET CONSTRAINTS ALL DEFERRED");
  }
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

function lifecyclePolicyInput(
  references: PolicyReferenceFixture,
  input: Record<string, unknown> = {},
): PolicyLifecycleInput {
  return policyTestInput(references, input) as unknown as PolicyLifecycleInput;
}

async function settleDeferredChecks(client: pg.PoolClient): Promise<void> {
  await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  await client.query("SET CONSTRAINTS ALL DEFERRED");
}

test("policy lifecycle atomically moves trusted drafts into the ledger", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for the lifecycle DB test");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const database = drizzle(client, { schema: databaseSchema });

  try {
    await client.query("BEGIN");
    const references = await createPolicyReferenceFixture(database);
    const admin = await createUser(database, {
      email: `lifecycle-admin-${randomUUID()}@example.test`,
      password: "StrongPass123!",
    });
    await database.insert(userCapabilities).values({
      capability: "admin",
      userId: admin.id,
    });
    const employeeContext = context(references.submittedByUserId, {
      staffRole: "employee",
    });
    const adminContext = context(admin.id, { capabilities: ["admin"] });
    const draftStartedAt = new Date("2026-06-30T12:00:00.000Z");
    const submittedAt = new Date("2026-07-01T10:00:00.000Z");
    const approvedAt = new Date("2026-07-01T11:00:00.000Z");

    const [queuedDraft] = await database
      .insert(drafts)
      .values({
        createdAt: draftStartedAt,
        lastEditedAt: draftStartedAt,
        ownerUserId: references.submittedByUserId,
      })
      .returning();
    assert.ok(queuedDraft);
    const queueEntryId = await submitDraftForApproval(
      database,
      employeeContext,
      queuedDraft.id,
      { insuredName: "Queued Insured", schemaVersion: 1 },
      submittedAt,
    );
    await settleDeferredChecks(client);

    const [submittedDraft] = await database
      .select()
      .from(drafts)
      .where(eq(drafts.id, queuedDraft.id));
    const [pendingQueue] = await database
      .select()
      .from(approvalQueueEntries)
      .where(eq(approvalQueueEntries.id, queueEntryId));
    assert.equal(submittedDraft?.status, "submitted");
    assert.equal(submittedDraft?.linkedQueueEntryId, queueEntryId);
    assert.equal(pendingQueue?.status, "pending");
    assert.equal(pendingQueue?.submittedByUserId, references.submittedByUserId);

    await expectDatabaseError(client, "55000", () =>
      submitDraftForApproval(
        database,
        employeeContext,
        queuedDraft.id,
        { schemaVersion: 1 },
        submittedAt,
      ),
    );

    const approvedPolicy = await approveQueuedPolicyInTransaction(
      database,
      adminContext,
      queueEntryId,
      lifecyclePolicyInput(references, {
        policyNumber: "LIFECYCLE-QUEUED",
      }),
      approvedAt,
    );
    await settleDeferredChecks(client);

    const [approvedDraft] = await database
      .select()
      .from(drafts)
      .where(eq(drafts.id, queuedDraft.id));
    const [approvedQueue] = await database
      .select()
      .from(approvalQueueEntries)
      .where(eq(approvalQueueEntries.id, queueEntryId));
    assert.equal(approvedPolicy.sourceDraftId, queuedDraft.id);
    assert.equal(approvedPolicy.submittedByUserId, references.submittedByUserId);
    assert.equal(approvedDraft?.status, "approved");
    assert.equal(approvedDraft?.linkedPolicyId, approvedPolicy.id);
    assert.equal(approvedQueue?.status, "approved");
    assert.equal(approvedQueue?.actedByUserId, admin.id);

    await expectDatabaseError(client, "23505", () =>
      database.insert(policies).values(
        policyTestInput(references, {
          policyNumber: "DUPLICATE-SOURCE",
          sourceDraftId: queuedDraft.id,
        }),
      ),
    );
    await expectDatabaseError(client, "55000", () =>
      database
        .update(policies)
        .set({ sourceDraftId: null })
        .where(eq(policies.id, approvedPolicy.id)),
    );

    const [sentBackDraft] = await database
      .insert(drafts)
      .values({
        createdAt: draftStartedAt,
        lastEditedAt: draftStartedAt,
        ownerUserId: references.submittedByUserId,
      })
      .returning();
    assert.ok(sentBackDraft);
    const sentBackQueueId = await submitDraftForApproval(
      database,
      employeeContext,
      sentBackDraft.id,
      { insuredName: "Needs correction", schemaVersion: 1 },
      new Date("2026-07-01T12:00:00.000Z"),
    );
    await sendBackQueuedDraft(
      database,
      adminContext,
      sentBackQueueId,
      "Correct the carrier",
      new Date("2026-07-01T13:00:00.000Z"),
    );
    await settleDeferredChecks(client);

    const [sentBack] = await database
      .select()
      .from(drafts)
      .where(eq(drafts.id, sentBackDraft.id));
    const [resolvedQueue] = await database
      .select()
      .from(approvalQueueEntries)
      .where(eq(approvalQueueEntries.id, sentBackQueueId));
    assert.equal(sentBack?.status, "sent_back");
    assert.equal(sentBack?.sentBackReason, "Correct the carrier");
    assert.equal(sentBack?.sentBackByUserId, admin.id);
    assert.equal(resolvedQueue?.status, "sent_back");
    assert.equal(resolvedQueue?.reason, "Correct the carrier");

    const [flaggedDraft] = await database
      .insert(drafts)
      .values({
        createdAt: draftStartedAt,
        lastEditedAt: draftStartedAt,
        ownerUserId: references.submittedByUserId,
      })
      .returning();
    assert.ok(flaggedDraft);
    await flagDraftForHelp(
      database,
      employeeContext,
      flaggedDraft.id,
      "Need help choosing the MGA",
      new Date("2026-07-01T14:00:00.000Z"),
    );
    await settleDeferredChecks(client);
    const [flagged] = await database
      .select()
      .from(drafts)
      .where(eq(drafts.id, flaggedDraft.id));
    assert.equal(flagged?.status, "flagged");
    assert.equal(flagged?.flagReason, "Need help choosing the MGA");

    const flaggedPolicy = await submitAdminPolicyDirectInTransaction(
      database,
      adminContext,
      lifecyclePolicyInput(references, {
        policyNumber: "LIFECYCLE-FLAGGED",
      }),
      flaggedDraft.id,
      new Date("2026-07-01T15:00:00.000Z"),
    );
    await settleDeferredChecks(client);
    const [resolvedFlag] = await database
      .select()
      .from(drafts)
      .where(eq(drafts.id, flaggedDraft.id));
    assert.equal(resolvedFlag?.status, "approved");
    assert.equal(resolvedFlag?.linkedPolicyId, flaggedPolicy.id);

    const freshAdminPolicy = await submitAdminPolicyDirectInTransaction(
      database,
      adminContext,
      lifecyclePolicyInput(references, {
        policyNumber: "LIFECYCLE-ADMIN-DIRECT",
      }),
      null,
      new Date("2026-07-01T16:00:00.000Z"),
    );
    await settleDeferredChecks(client);
    assert.equal(freshAdminPolicy.sourceDraftId, null);
    assert.equal(freshAdminPolicy.submittedByUserId, admin.id);
    const directQueues = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(approvalQueueEntries)
      .where(eq(approvalQueueEntries.submittedByUserId, admin.id));
    assert.equal(directQueues[0]?.count, 0);

    const [invalidPayloadDraft] = await database
      .insert(drafts)
      .values({
        createdAt: draftStartedAt,
        lastEditedAt: draftStartedAt,
        ownerUserId: references.submittedByUserId,
      })
      .returning();
    assert.ok(invalidPayloadDraft);
    await expectDatabaseError(client, "23514", () =>
      submitDraftForApproval(
        database,
        employeeContext,
        invalidPayloadDraft.id,
        { insuredName: "Missing schema version" },
      ),
    );
    const [unchangedInvalidDraft] = await database
      .select()
      .from(drafts)
      .where(eq(drafts.id, invalidPayloadDraft.id));
    assert.equal(unchangedInvalidDraft?.status, "draft");

    const [failedApprovalDraft] = await database
      .insert(drafts)
      .values({
        createdAt: draftStartedAt,
        lastEditedAt: draftStartedAt,
        ownerUserId: references.submittedByUserId,
      })
      .returning();
    assert.ok(failedApprovalDraft);
    const failedApprovalQueueId = await submitDraftForApproval(
      database,
      employeeContext,
      failedApprovalDraft.id,
      { insuredName: "Invalid policy reference", schemaVersion: 1 },
    );
    await settleDeferredChecks(client);
    await expectDatabaseError(client, "23503", () =>
      approveQueuedPolicyInTransaction(
        database,
        adminContext,
        failedApprovalQueueId,
        lifecyclePolicyInput(references, {
          carrierId: randomUUID(),
          policyNumber: "LIFECYCLE-ROLLBACK",
        }),
      ),
    );
    const [stillPending] = await database
      .select()
      .from(approvalQueueEntries)
      .where(eq(approvalQueueEntries.id, failedApprovalQueueId));
    const [stillSubmitted] = await database
      .select()
      .from(drafts)
      .where(eq(drafts.id, failedApprovalDraft.id));
    const rolledBackPolicies = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(policies)
      .where(eq(policies.policyNumber, "LIFECYCLE-ROLLBACK"));
    assert.equal(stillPending?.status, "pending");
    assert.equal(stillSubmitted?.status, "submitted");
    assert.equal(rolledBackPolicies[0]?.count, 0);

    const forgedAdminContext = context(references.submittedByUserId, {
      capabilities: ["admin"],
      staffRole: "employee",
    });
    await expectDatabaseError(client, "42501", () =>
      submitAdminPolicyDirectInTransaction(
        database,
        forgedAdminContext,
        lifecyclePolicyInput(references, {
          policyNumber: "FORGED-ADMIN-POLICY",
        }),
      ),
    );
    const forgedPolicies = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(policies)
      .where(eq(policies.policyNumber, "FORGED-ADMIN-POLICY"));
    assert.equal(forgedPolicies[0]?.count, 0);

    const [inconsistentDraft] = await database
      .insert(drafts)
      .values({
        createdAt: draftStartedAt,
        lastEditedAt: draftStartedAt,
        ownerUserId: references.submittedByUserId,
      })
      .returning();
    assert.ok(inconsistentDraft);
    await expectDatabaseError(client, "23514", async () => {
      await database.insert(approvalQueueEntries).values({
        draftId: inconsistentDraft.id,
        submittedByUserId: references.submittedByUserId,
        submittedPayload: { schemaVersion: 1 },
      });
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    });

    const lifecycleAudits = await database
      .select({ action: auditEvents.action, actorUserId: auditEvents.actorUserId })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.actorUserId, admin.id),
          sql`${auditEvents.action} in ('draft_sent_back', 'policy_approved', 'admin_policy_submitted')`,
        ),
      );
    assert.equal(
      lifecycleAudits.some((event) => event.action === "policy_approved"),
      true,
    );
    assert.equal(
      lifecycleAudits.some((event) => event.action === "draft_sent_back"),
      true,
    );
    assert.equal(
      lifecycleAudits.filter(
        (event) => event.action === "admin_policy_submitted",
      ).length,
      2,
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
