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
  policyOverrides,
  userCapabilities,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { createOwnDraft } from "../drafts/create.js";
import { buildDraftSubmissionSnapshot } from "../drafts/submit.js";
import type { AppLogger } from "../logging/logger.js";
import { submitDraftForApproval } from "../policies/lifecycle.js";
import {
  ApprovalOverrideValidationError,
  approvePendingSubmissionWithOverride,
} from "./approve-with-override.js";

const logger: AppLogger = { error() {}, info() {}, warn() {} };

test("approval-time override preserves sources and rolls back every failure", async () => {
  const sourceDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(sourceDatabaseUrl, "DATABASE_URL is required for override test");

  await withDisposableMigratedDatabase(
    sourceDatabaseUrl,
    "wcib_appr_override",
    async (databaseUrl) => {
      const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const references = await createPolicyReferenceFixture(database);
        const admin = await createUser(database, {
          email: `approval-override-admin-${randomUUID()}@example.test`,
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

        const successful = await createQueuedSubmission(
          database,
          employeeContext,
          references,
          "OVERRIDE-SUCCESS",
          new Date("2026-07-11T01:00:00.000Z"),
        );
        const result = await approvePendingSubmissionWithOverride(
          database,
          adminContext,
          successful.queueId,
          overrideInput({
            brokerFee: "30.00",
            commissionAmount: "150.00",
          }),
          logger,
          new Date("2026-07-11T02:00:00.000Z"),
        );

        assert.equal(result.policy.policyNumber, "OVERRIDE-SUCCESS");
        assert.equal(result.policy.basePremium, successful.snapshot.basePremium);
        assert.equal(result.policy.insuredName, successful.snapshot.insuredName);
        assert.equal(result.policy.brokerFee, "30.00");
        assert.equal(result.policy.commissionAmount, "150.00");
        assert.equal(result.policy.netDue, "70.00");
        assert.equal(result.policy.proposalTotal, "1040.00");
        assert.equal(result.policy.overridden, true);
        assert.equal(result.policy.sourceDraftId, successful.draftId);
        const [storedOverride] = await database
          .select()
          .from(policyOverrides)
          .where(eq(policyOverrides.id, result.overrideId));
        assert.deepEqual(storedOverride?.originalValues, {
          brokerFee: "20.00",
          commissionAmount: "125.00",
        });
        assert.deepEqual(storedOverride?.replacementValues, {
          brokerFee: "30.00",
          commissionAmount: "150.00",
        });
        assert.equal(
          storedOverride?.reason,
          "Carrier corrected the bound figures",
        );
        assert.equal(storedOverride?.approvedByUserId, admin.id);

        const [resolvedQueue] = await database
          .select()
          .from(approvalQueueEntries)
          .where(eq(approvalQueueEntries.id, successful.queueId));
        const [resolvedDraft] = await database
          .select()
          .from(drafts)
          .where(eq(drafts.id, successful.draftId));
        assert.equal(resolvedQueue?.status, "approved");
        assert.deepEqual(resolvedQueue?.submittedPayload, successful.snapshot);
        assert.equal(resolvedDraft?.status, "approved");
        assert.equal(resolvedDraft?.linkedPolicyId, result.policy.id);

        const audits = await database
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.actorUserId, admin.id),
              sql`${auditEvents.action} in ('policy_approved', 'policy_override_applied')`,
            ),
          );
        assert.equal(audits.length, 2);
        assert.equal(
          audits.some(
            (event) =>
              event.action === "policy_approved" &&
              event.entityType === "policy" &&
              event.entityId === result.policy.id,
          ),
          true,
        );
        assert.equal(
          audits.some(
            (event) =>
              event.action === "policy_override_applied" &&
              event.entityType === "policy_override" &&
              event.entityId === result.overrideId &&
              (event.afterSummary as Record<string, unknown> | null)
                ?.policyId === result.policy.id,
          ),
          true,
        );

        const denied = await createQueuedSubmission(
          database,
          employeeContext,
          references,
          "OVERRIDE-DENIED",
          new Date("2026-07-11T03:00:00.000Z"),
        );
        await assertNoMutation(
          database,
          denied,
          () =>
            approvePendingSubmissionWithOverride(
              database,
              employeeContext,
              denied.queueId,
              overrideInput({ brokerFee: "30.00" }),
              logger,
              new Date("2026-07-11T04:00:00.000Z"),
            ),
        );

        const unchanged = await createQueuedSubmission(
          database,
          employeeContext,
          references,
          "OVERRIDE-UNCHANGED",
          new Date("2026-07-11T05:00:00.000Z"),
        );
        await assertNoMutation(
          database,
          unchanged,
          () =>
            approvePendingSubmissionWithOverride(
              database,
              adminContext,
              unchanged.queueId,
              overrideInput({ brokerFee: "20.00" }),
              logger,
              new Date("2026-07-11T06:00:00.000Z"),
            ),
          (error: unknown) => error instanceof ApprovalOverrideValidationError,
        );

        const invalidCombination = await createQueuedSubmission(
          database,
          employeeContext,
          references,
          "OVERRIDE-INVALID-COMBINATION",
          new Date("2026-07-11T07:00:00.000Z"),
        );
        await assertNoMutation(database, invalidCombination, () =>
          approvePendingSubmissionWithOverride(
            database,
            adminContext,
            invalidCombination.queueId,
            overrideInput({ commissionAmount: "1.00", commissionMode: "tbd" }),
            logger,
            new Date("2026-07-11T08:00:00.000Z"),
          ),
        );

        const concurrent = await createQueuedSubmission(
          database,
          employeeContext,
          references,
          "OVERRIDE-CONCURRENT",
          new Date("2026-07-11T09:00:00.000Z"),
        );
        const concurrentResults = await Promise.allSettled([
          approvePendingSubmissionWithOverride(
            database,
            adminContext,
            concurrent.queueId,
            overrideInput({ brokerFee: "30.00" }),
            logger,
            new Date("2026-07-11T10:00:00.000Z"),
          ),
          approvePendingSubmissionWithOverride(
            database,
            adminContext,
            concurrent.queueId,
            overrideInput({ brokerFee: "35.00" }),
            logger,
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
        const concurrentPolicies = await database
          .select({ id: policies.id })
          .from(policies)
          .where(eq(policies.sourceDraftId, concurrent.draftId));
        assert.equal(concurrentPolicies.length, 1);
        const concurrentOverrides = await database
          .select({ id: policyOverrides.id })
          .from(policyOverrides)
          .where(eq(policyOverrides.policyId, concurrentPolicies[0]!.id));
        assert.equal(concurrentOverrides.length, 1);

        await verifyAuditRollback(
          database,
          adminContext,
          employeeContext,
          references,
          "policy_approved",
          "OVERRIDE-APPROVAL-AUDIT-ROLLBACK",
          new Date("2026-07-11T11:00:00.000Z"),
        );
        await verifyAuditRollback(
          database,
          adminContext,
          employeeContext,
          references,
          "policy_override_applied",
          "OVERRIDE-AUDIT-ROLLBACK",
          new Date("2026-07-11T13:00:00.000Z"),
        );
        await verifyCommitRollback(
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

async function verifyAuditRollback(
  database: Parameters<typeof createOwnDraft>[0],
  adminContext: AuthorizedRequestContext,
  employeeContext: AuthorizedRequestContext,
  references: PolicyReferenceFixture,
  action: "policy_approved" | "policy_override_applied",
  policyNumber: string,
  startedAt: Date,
): Promise<void> {
  const queued = await createQueuedSubmission(
    database,
    employeeContext,
    references,
    policyNumber,
    startedAt,
  );
  const functionName = `reject_${action}_for_parent_d`;
  const triggerName = `${functionName}_trigger`;
  await database.execute(sql.raw(`
    CREATE FUNCTION ${functionName}()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.action = '${action}' THEN
        RAISE EXCEPTION 'forced audit failure';
      END IF;
      RETURN NEW;
    END;
    $$
  `));
  await database.execute(sql.raw(`
    CREATE TRIGGER ${triggerName}
    BEFORE INSERT ON audit_events
    FOR EACH ROW EXECUTE FUNCTION ${functionName}()
  `));
  try {
    await assertNoMutation(
      database,
      queued,
      () =>
        approvePendingSubmissionWithOverride(
          database,
          adminContext,
          queued.queueId,
          overrideInput({ brokerFee: "30.00" }),
          logger,
          new Date(startedAt.getTime() + 3_600_000),
        ),
      (error: unknown) => readDatabaseErrorCode(error) === "P0001",
    );
  } finally {
    await database.execute(
      sql.raw(`DROP TRIGGER ${triggerName} ON audit_events`),
    );
    await database.execute(sql.raw(`DROP FUNCTION ${functionName}()`));
  }
}

async function verifyCommitRollback(
  database: Parameters<typeof createOwnDraft>[0],
  adminContext: AuthorizedRequestContext,
  employeeContext: AuthorizedRequestContext,
  references: PolicyReferenceFixture,
): Promise<void> {
  const queued = await createQueuedSubmission(
    database,
    employeeContext,
    references,
    "OVERRIDE-COMMIT-ROLLBACK",
    new Date("2026-07-11T15:00:00.000Z"),
  );
  await database.execute(sql`
    CREATE FUNCTION reject_parent_d_override_commit()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.overridden = true THEN
        RAISE EXCEPTION 'forced deferred commit failure';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await database.execute(sql`
    CREATE CONSTRAINT TRIGGER reject_parent_d_override_commit_trigger
    AFTER INSERT OR UPDATE ON policies
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION reject_parent_d_override_commit()
  `);
  try {
    await assertNoMutation(
      database,
      queued,
      () =>
        approvePendingSubmissionWithOverride(
          database,
          adminContext,
          queued.queueId,
          overrideInput({ brokerFee: "30.00" }),
          logger,
          new Date("2026-07-11T16:00:00.000Z"),
        ),
      (error: unknown) => readDatabaseErrorCode(error) === "P0001",
    );
  } finally {
    await database.execute(
      sql`DROP TRIGGER reject_parent_d_override_commit_trigger ON policies`,
    );
    await database.execute(sql`DROP FUNCTION reject_parent_d_override_commit()`);
  }
}

async function assertNoMutation(
  database: Parameters<typeof createOwnDraft>[0],
  queued: { draftId: string; queueId: string },
  action: () => Promise<unknown>,
  error?: (error: unknown) => boolean,
): Promise<void> {
  const before = await mutationCounts(database);
  if (error === undefined) {
    await assert.rejects(action);
  } else {
    await assert.rejects(action, error);
  }
  assert.deepEqual(await mutationCounts(database), before);
  const [queue] = await database
    .select()
    .from(approvalQueueEntries)
    .where(eq(approvalQueueEntries.id, queued.queueId));
  const [draft] = await database
    .select()
    .from(drafts)
    .where(eq(drafts.id, queued.draftId));
  assert.equal(queue?.status, "pending");
  assert.equal(queue?.actedAt, null);
  assert.equal(draft?.status, "submitted");
  assert.equal(draft?.linkedPolicyId, null);
}

async function mutationCounts(database: Parameters<typeof createOwnDraft>[0]) {
  const result = await database.execute<{
    audit_count: number;
    override_count: number;
    policy_count: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM audit_events) AS audit_count,
      (SELECT count(*)::int FROM policy_overrides) AS override_count,
      (SELECT count(*)::int FROM policies) AS policy_count
  `);
  return result.rows[0];
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
  const snapshot = buildDraftSubmissionSnapshot(draft);
  const queueId = await submitDraftForApproval(
    database,
    employeeContext,
    draft.id,
    snapshot,
    new Date(startedAt.getTime() + 60_000),
  );
  return { draftId: draft.id, queueId, snapshot };
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
    insuredName: "Immutable Submitted Insured",
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

function overrideInput(
  replacementValues: Partial<{
    brokerFee: string;
    commissionAmount: string;
    commissionMode: "pct" | "tbd" | "na";
    netDue: string;
  }>,
) {
  return {
    changedFields: Object.keys(replacementValues),
    reason: "  Carrier corrected the bound figures  ",
    replacementValues,
  };
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
