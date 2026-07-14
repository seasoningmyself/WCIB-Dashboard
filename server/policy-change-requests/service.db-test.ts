import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import { DraftAccessDeniedError } from "../drafts/access.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "../db/policy-test-fixture.js";
import {
  auditEvents,
  drafts,
  policies,
  policyChangeRequests,
  policyOverrides,
  staffProfiles,
  userCapabilities,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import { PolicyLifecycleAccessError } from "../policies/lifecycle.js";
import {
  correctPolicyChangeRequest,
  createOwnPolicyChangeRequest,
  listPendingPolicyChangeRequests,
  listOwnPolicyChangeRequests,
  PolicyChangeRequestAccessDeniedError,
  PolicyChangeRequestStateError,
  resolvePolicyChangeRequestAsIs,
  sendBackPolicyChangeRequest,
} from "./service.js";

const logger: AppLogger = { error() {}, info() {}, warn() {} };

test("approved-policy change requests preserve one canonical policy and audit every admin resolution", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for change-request test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_change_request",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 4 });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const references = await createPolicyReferenceFixture(database);
        const admin = await createUser(database, {
          email: `change-request-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        const outsider = await createUser(database, {
          email: `change-request-outsider-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        await database.insert(staffProfiles).values({
          displayName: `Change Request Outsider ${randomUUID()}`,
          role: "employee",
          userId: outsider.id,
        });

        const owner = staffContext(references.submittedByUserId, "employee");
        const nonOwner = staffContext(outsider.id, "employee");
        const producerNonOwner = staffContext(
          references.producerUserId,
          "producer",
        );
        const adminContext = context(admin.id, { capabilities: ["admin"] });
        const initialAt = new Date("2026-07-14T10:00:00.000Z");
        const [policy] = await database
          .insert(policies)
          .values(
            policyTestInput(references, {
              accountAssignment: "book",
              amountPaid: "1150.00",
              basePremium: "1000.00",
              brokerFee: "75.00",
              commissionAmount: "125.00",
              commissionConfirmed: true,
              commissionMode: "pct",
              commissionRate: "12.5000",
              createdAt: initialAt,
              depositOption: "300.00",
              financeBalance: "75.00",
              financeContact: { email: "insured@example.test" },
              financeMeta: { provider: "IPFS" },
              financeReference: "FIN-ORIGINAL",
              insuredName: "Canonical Policy Owner",
              ipfsFinanced: "yes",
              ipfsManual: false,
              ipfsReturning: "returning",
              kayleeSplit: "book",
              mgaFee: "50.00",
              netDue: "950.00",
              notes: "Original note",
              paymentMode: "deposit",
              policyNumber: "CHANGE-REQUEST-001",
              producerUserId: references.producerUserId,
              proposalTotal: "1225.00",
              sourceDraftId: null,
              taxes: "100.00",
              updatedAt: initialAt,
            }),
          )
          .returning();
        assert.ok(policy);

        const beforeRequest = await canonicalState(pool, policy.id);
        const requestedAt = new Date("2026-07-14T11:00:00.000Z");
        const request = await createOwnPolicyChangeRequest(
          database,
          owner,
          policy.id,
          { reason: "The insured name needs review." },
          logger,
          requestedAt,
        );
        assert.equal(request.policyId, policy.id);
        assert.equal(request.requestedByUserId, references.submittedByUserId);
        assert.equal(request.status, "pending");
        assert.deepEqual(await canonicalState(pool, policy.id), beforeRequest);
        assert.equal(
          await actionCount(database, request.id, "policy_change_request_created"),
          1,
        );
        assert.deepEqual(
          (await listOwnPolicyChangeRequests(database, owner)).map(({ id }) => id),
          [request.id],
        );
        const adminPending = await listPendingPolicyChangeRequests(
          database,
          adminContext,
        );
        assert.equal(adminPending.length, 1);
        assert.equal(adminPending[0]?.request.id, request.id);
        assert.equal(adminPending[0]?.insuredName, "Canonical Policy Owner");
        assert.equal(
          (await listOwnPolicyChangeRequests(database, nonOwner)).length,
          0,
        );

        await assert.rejects(
          createOwnPolicyChangeRequest(
            database,
            nonOwner,
            policy.id,
            { reason: "Not my policy" },
            logger,
          ),
          PolicyChangeRequestAccessDeniedError,
        );
        await assert.rejects(
          createOwnPolicyChangeRequest(
            database,
            producerNonOwner,
            policy.id,
            { reason: "Not my policy" },
            logger,
          ),
          PolicyChangeRequestAccessDeniedError,
        );
        await assert.rejects(
          createOwnPolicyChangeRequest(
            database,
            adminContext,
            policy.id,
            { reason: "Admin cannot impersonate an owner" },
            logger,
          ),
          DraftAccessDeniedError,
        );
        await assert.rejects(
          createOwnPolicyChangeRequest(
            database,
            owner,
            policy.id,
            { reason: "Duplicate pending request" },
            logger,
          ),
          PolicyChangeRequestStateError,
        );
        await assert.rejects(
          createOwnPolicyChangeRequest(
            database,
            owner,
            policy.id,
            { reason: "Reason only", brokerFee: "0.00" },
            logger,
          ),
        );

        for (const statement of [
          `UPDATE policy_change_requests SET reason = 'tampered' WHERE id = '${request.id}'`,
          `DELETE FROM policy_change_requests WHERE id = '${request.id}'`,
          `INSERT INTO policy_change_requests (policy_id, requested_by_user_id, reason) VALUES ('${policy.id}', '${references.submittedByUserId}', 'direct')`,
        ]) {
          await assert.rejects(
            pool.query(statement),
            (error: unknown) => readDatabaseErrorCode(error) === "55000",
          );
        }

        await assert.rejects(
          resolvePolicyChangeRequestAsIs(
            database,
            owner,
            request.id,
            logger,
          ),
          PolicyLifecycleAccessError,
        );
        const asIs = await resolvePolicyChangeRequestAsIs(
          database,
          adminContext,
          request.id,
          logger,
          new Date("2026-07-14T12:00:00.000Z"),
        );
        assert.equal(asIs.request.resolution, "as_is");
        assert.deepEqual(await canonicalState(pool, policy.id), beforeRequest);
        assert.equal(
          await actionCount(
            database,
            request.id,
            "policy_change_request_resolved_as_is",
          ),
          1,
        );

        const sentBackRequest = await createOwnPolicyChangeRequest(
          database,
          owner,
          policy.id,
          { reason: "Please review the policy dates." },
          logger,
          new Date("2026-07-14T13:00:00.000Z"),
        );
        const sentBack = await sendBackPolicyChangeRequest(
          database,
          adminContext,
          sentBackRequest.id,
          { reason: "No ledger correction is required." },
          logger,
          new Date("2026-07-14T14:00:00.000Z"),
        );
        assert.equal(sentBack.request.status, "rejected");
        assert.equal(sentBack.request.resolution, "sent_back");
        assert.equal(
          sentBack.request.resolutionReason,
          "No ledger correction is required.",
        );
        assert.deepEqual(await canonicalState(pool, policy.id), beforeRequest);

        const generalRequest = await createOwnPolicyChangeRequest(
          database,
          owner,
          policy.id,
          { reason: "Correct the insured name." },
          logger,
          new Date("2026-07-14T15:00:00.000Z"),
        );
        await assert.rejects(
          correctPolicyChangeRequest(
            database,
            owner,
            generalRequest.id,
            generalCorrection(initialAt, "Owner cannot write"),
            logger,
          ),
          PolicyLifecycleAccessError,
        );
        const general = await correctPolicyChangeRequest(
          database,
          adminContext,
          generalRequest.id,
          generalCorrection(initialAt, "Canonical Policy Corrected"),
          logger,
          new Date("2026-07-14T16:00:00.000Z"),
        );
        assert.equal(general.policy.id, policy.id);
        assert.equal(general.policy.insuredName, "Canonical Policy Corrected");
        assert.equal(general.source.request.mutationKind, "general");
        assert.ok(general.source.request.mutationId);
        assert.equal(
          await actionCount(database, policy.id, "policy_corrected"),
          1,
        );
        assert.equal(
          await actionCount(
            database,
            generalRequest.id,
            "policy_change_request_corrected",
          ),
          1,
        );
        assert.equal((await canonicalState(pool, policy.id)).policyCount, 1);
        assert.equal((await canonicalState(pool, policy.id)).draftCount, 1);

        const overrideRequest = await createOwnPolicyChangeRequest(
          database,
          owner,
          policy.id,
          { reason: "Correct the recorded agency fee." },
          logger,
          new Date("2026-07-14T17:00:00.000Z"),
        );
        const overridden = await correctPolicyChangeRequest(
          database,
          adminContext,
          overrideRequest.id,
          overrideCorrection(
            general.policy.updatedAt,
            "90.00",
          ),
          logger,
          new Date("2026-07-14T18:00:00.000Z"),
        );
        assert.equal(overridden.policy.id, policy.id);
        assert.equal(overridden.policy.brokerFee, "90.00");
        assert.equal(overridden.source.request.mutationKind, "override");
        assert.equal(
          await actionCount(
            database,
            overrideRequest.id,
            "policy_change_request_corrected",
          ),
          1,
        );
        assert.equal(
          await relatedOverrideCount(database, policy.id),
          1,
        );

        const rollbackGeneral = await createOwnPolicyChangeRequest(
          database,
          owner,
          policy.id,
          { reason: "This correction must roll back." },
          logger,
          new Date("2026-07-14T19:00:00.000Z"),
        );
        await installFailingAuditTrigger(
          pool,
          "policy_change_request_corrected",
        );
        const beforeGeneralFailure = await canonicalState(pool, policy.id);
        await assert.rejects(
          correctPolicyChangeRequest(
            database,
            adminContext,
            rollbackGeneral.id,
            generalCorrection(
              overridden.policy.updatedAt,
              "Must Not Persist",
            ),
            logger,
            new Date("2026-07-14T20:00:00.000Z"),
          ),
          PolicyChangeRequestStateError,
        );
        assert.deepEqual(
          await canonicalState(pool, policy.id),
          beforeGeneralFailure,
        );
        assert.equal(
          (await requestById(database, rollbackGeneral.id)).status,
          "pending",
        );
        await removeFailingAuditTrigger(pool);
        await resolvePolicyChangeRequestAsIs(
          database,
          adminContext,
          rollbackGeneral.id,
          logger,
          new Date("2026-07-14T20:01:00.000Z"),
        );

        const rollbackOverride = await createOwnPolicyChangeRequest(
          database,
          owner,
          policy.id,
          { reason: "This override must roll back." },
          logger,
          new Date("2026-07-14T21:00:00.000Z"),
        );
        await installFailingAuditTrigger(
          pool,
          "policy_change_request_corrected",
        );
        const beforeOverrideFailure = await canonicalState(pool, policy.id);
        await assert.rejects(
          correctPolicyChangeRequest(
            database,
            adminContext,
            rollbackOverride.id,
            overrideCorrection(overridden.policy.updatedAt, "110.00"),
            logger,
            new Date("2026-07-14T22:00:00.000Z"),
          ),
          PolicyChangeRequestStateError,
        );
        assert.deepEqual(
          await canonicalState(pool, policy.id),
          beforeOverrideFailure,
        );
        assert.equal(
          (await requestById(database, rollbackOverride.id)).status,
          "pending",
        );
        await removeFailingAuditTrigger(pool);

        const auditFailurePolicy = await database
          .insert(policies)
          .values(
            policyTestInput(references, {
              createdAt: initialAt,
              policyNumber: "CHANGE-REQUEST-AUDIT-ROLLBACK",
              sourceDraftId: null,
              updatedAt: initialAt,
            }),
          )
          .returning({ id: policies.id });
        assert.ok(auditFailurePolicy[0]);
        await installFailingAuditTrigger(pool, "policy_change_request_created");
        await assert.rejects(
          createOwnPolicyChangeRequest(
            database,
            owner,
            auditFailurePolicy[0].id,
            { reason: "Must not persist without audit." },
            logger,
            new Date("2026-07-14T23:00:00.000Z"),
          ),
          PolicyChangeRequestStateError,
        );
        assert.equal(
          await requestCountForPolicy(database, auditFailurePolicy[0].id),
          0,
        );
        await removeFailingAuditTrigger(pool);

        const [producerOwnedPolicy] = await database
          .insert(policies)
          .values(
            policyTestInput(references, {
              policyNumber: "CHANGE-REQUEST-PRODUCER-OWNER",
              sourceDraftId: null,
              submittedByUserId: references.producerUserId,
            }),
          )
          .returning({ id: policies.id });
        assert.ok(producerOwnedPolicy);
        const producerRequest = await createOwnPolicyChangeRequest(
          database,
          producerNonOwner,
          producerOwnedPolicy.id,
          { reason: "Producer-originated policy needs admin review." },
          logger,
          new Date("2026-07-14T23:30:00.000Z"),
        );
        assert.equal(producerRequest.requestedByUserId, references.producerUserId);
        await resolvePolicyChangeRequestAsIs(
          database,
          adminContext,
          producerRequest.id,
          logger,
          new Date("2026-07-14T23:31:00.000Z"),
        );
      } finally {
        await pool.end();
      }
    },
  );
});

function generalCorrection(expected: Date, insuredName: string) {
  return {
    change: {
      changedFields: ["insuredName"],
      reason: "Correct the approved insured name",
      replacementValues: { insuredName },
    },
    expectedUpdatedAt: expected.toISOString(),
    kind: "general",
  } as const;
}

function overrideCorrection(expected: Date, brokerFee: string) {
  return {
    change: {
      changedFields: ["brokerFee"],
      reason: "Correct the approved agency fee",
      replacementValues: { brokerFee },
    },
    expectedUpdatedAt: expected.toISOString(),
    kind: "override",
  } as const;
}

async function canonicalState(pool: pg.Pool, policyId: string) {
  const result = await pool.query<{
    draft_count: number;
    policy_count: number;
    policy_row: string;
  }>(
    `SELECT
       row_to_json(policy_row)::text AS policy_row,
       (SELECT count(*)::int FROM policies) AS policy_count,
       (SELECT count(*)::int FROM drafts) AS draft_count
     FROM policies AS policy_row
     WHERE policy_row.id = $1`,
    [policyId],
  );
  assert.ok(result.rows[0]);
  return {
    draftCount: result.rows[0].draft_count,
    policyCount: result.rows[0].policy_count,
    policyRow: result.rows[0].policy_row,
  };
}

async function actionCount(
  database: ReturnType<typeof drizzle<typeof databaseSchema>>,
  entityId: string,
  action: typeof auditEvents.$inferSelect.action,
): Promise<number> {
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(auditEvents)
    .where(sql`${auditEvents.entityId} = ${entityId} and ${auditEvents.action} = ${action}`);
  return row?.count ?? 0;
}

async function relatedOverrideCount(
  database: ReturnType<typeof drizzle<typeof databaseSchema>>,
  policyId: string,
): Promise<number> {
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(policyOverrides)
    .where(eq(policyOverrides.policyId, policyId));
  return row?.count ?? 0;
}

async function requestCountForPolicy(
  database: ReturnType<typeof drizzle<typeof databaseSchema>>,
  policyId: string,
): Promise<number> {
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(policyChangeRequests)
    .where(eq(policyChangeRequests.policyId, policyId));
  return row?.count ?? 0;
}

async function requestById(
  database: ReturnType<typeof drizzle<typeof databaseSchema>>,
  requestId: string,
) {
  const [request] = await database
    .select()
    .from(policyChangeRequests)
    .where(eq(policyChangeRequests.id, requestId));
  assert.ok(request);
  return request;
}

async function installFailingAuditTrigger(
  pool: pg.Pool,
  action: typeof auditEvents.$inferSelect.action,
): Promise<void> {
  await pool.query(`
    CREATE OR REPLACE FUNCTION fail_policy_change_request_audit_for_test()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.action = '${action}' THEN
        RAISE EXCEPTION 'forced policy change-request audit failure'
          USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await pool.query(`
    CREATE TRIGGER fail_policy_change_request_audit_for_test_trigger
    BEFORE INSERT ON audit_events
    FOR EACH ROW
    EXECUTE FUNCTION fail_policy_change_request_audit_for_test()
  `);
}

async function removeFailingAuditTrigger(pool: pg.Pool): Promise<void> {
  await pool.query(
    "DROP TRIGGER fail_policy_change_request_audit_for_test_trigger ON audit_events",
  );
  await pool.query("DROP FUNCTION fail_policy_change_request_audit_for_test()");
}

function staffContext(
  userId: string,
  staffRole: "employee" | "producer",
): AuthorizedRequestContext {
  return context(userId, { staffRole });
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
