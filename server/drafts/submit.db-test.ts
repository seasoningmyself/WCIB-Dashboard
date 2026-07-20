import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { CreateDraftRequest } from "../../shared/drafts.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import {
  approvalQueueEntries,
  auditEvents,
  carriers,
  drafts,
  mgas,
  officeLocations,
  policies,
  policyTypes,
  staffProfiles,
  userCapabilities,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { createOwnDraft, DraftInputValidationError } from "./create.js";
import {
  DraftNotSubmittableError,
  DraftSubmissionNotFoundError,
  submitOwnDraft,
} from "./submit.js";

test("draft submission atomically composes queue and ledger lifecycle paths", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for draft submit test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_draft_submit",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 8 });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const employee = await createUser(database, {
          displayName: "Submit Employee",
          email: `submit-employee-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        const producer = await createUser(database, {
          displayName: "Submit Producer",
          email: `submit-producer-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        const admin = await createUser(database, {
          email: `submit-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(staffProfiles).values([
          { role: "employee", userId: employee.id },
          { role: "producer", userId: producer.id },
        ]);
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const references = await createReferences(database);
        const employeeContext = staffContext(employee.id, "employee");
        const producerContext = staffContext(producer.id, "producer");
        const adminContext: AuthorizedRequestContext = {
          principal: {
            capabilities: ["admin"],
            staffRole: null,
            userActive: true,
            userId: admin.id,
          },
        };

        const staffDraft = await createOwnDraft(
          database,
          employeeContext,
          validInput(references, {
            amountPaid: "300.00",
            depositOption: "300.00",
            financeContact: {
              address: "100 Main Street",
              email: "insured@example.test",
              mobile: "555-0100",
            },
            financeReference: "IPFS-QUOTE-1",
            ipfsFinanced: "yes",
            ipfsReturning: "new",
            paymentMode: "deposit",
          }),
          new Date("2026-07-10T01:00:00.000Z"),
        );
        const staffResult = await submitOwnDraft(
          database,
          employeeContext,
          staffDraft.id,
          new Date("2026-07-10T02:00:00.000Z"),
        );
        assert.equal(staffResult.destination, "approval");
        assert.equal(staffResult.draft.status, "submitted");
        assert.equal(staffResult.draft.ownerUserId, employee.id);

        const [queueEntry] = await database
          .select()
          .from(approvalQueueEntries)
          .where(eq(approvalQueueEntries.draftId, staffDraft.id));
        assert.ok(queueEntry);
        const snapshot = queueEntry.submittedPayload as Record<string, unknown>;
        assert.equal(snapshot.insuredName, "Submission Insured");
        assert.equal(snapshot.commissionAmount, "100.00");
        assert.equal(snapshot.netDue, "150.00");
        assert.equal(snapshot.financeBalance, "780.00");
        assert.equal(snapshot.ipfsFinanced, "yes");
        assert.equal(snapshot.kayleeSplit, "none");
        for (const field of [
          "applicableProducerRate",
          "producerPayout",
          "producerRate",
          "producerRateHistory",
        ]) {
          assert.equal(field in snapshot, false, field);
        }
        const staffAudits = await database
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.action, "draft_submitted"),
              eq(auditEvents.entityId, queueEntry.id),
            ),
          );
        assert.equal(staffAudits.length, 1);
        await assert.rejects(
          submitOwnDraft(database, employeeContext, staffDraft.id),
          DraftNotSubmittableError,
        );
        await assert.rejects(
          submitOwnDraft(database, producerContext, staffDraft.id),
          DraftSubmissionNotFoundError,
        );

        const concurrentDraft = await createOwnDraft(
          database,
          producerContext,
          validInput(references, {
            accountAssignment: "book",
            producerUserId: producer.id,
          }),
          new Date("2026-07-10T03:00:00.000Z"),
        );
        const concurrent = await Promise.allSettled([
          submitOwnDraft(
            database,
            producerContext,
            concurrentDraft.id,
            new Date("2026-07-10T04:00:00.000Z"),
          ),
          submitOwnDraft(
            database,
            producerContext,
            concurrentDraft.id,
            new Date("2026-07-10T04:00:00.000Z"),
          ),
        ]);
        assert.equal(
          concurrent.filter(({ status }) => status === "fulfilled").length,
          1,
        );
        const rejected = concurrent.find(({ status }) => status === "rejected");
        assert.ok(rejected?.status === "rejected");
        assert.ok(rejected.reason instanceof DraftNotSubmittableError);
        const concurrentQueues = await database
          .select({ count: sql<number>`count(*)::int` })
          .from(approvalQueueEntries)
          .where(eq(approvalQueueEntries.draftId, concurrentDraft.id));
        assert.equal(concurrentQueues[0]?.count, 1);

        const adminDraft = await createOwnDraft(
          database,
          adminContext,
          validInput(references),
          new Date("2026-07-10T05:00:00.000Z"),
        );
        const adminResult = await submitOwnDraft(
          database,
          adminContext,
          adminDraft.id,
          new Date("2026-07-10T06:00:00.000Z"),
        );
        assert.equal(adminResult.destination, "ledger");
        assert.equal(adminResult.draft.status, "approved");
        const [policy] = await database
          .select()
          .from(policies)
          .where(eq(policies.sourceDraftId, adminDraft.id));
        assert.ok(policy);
        assert.equal(policy.submittedByUserId, admin.id);
        assert.equal(policy.commissionAmount, "100.00");
        assert.equal(policy.netDue, "350.00");
        assert.equal(policy.kayleeSplit, "none");
        const adminQueues = await database
          .select({ count: sql<number>`count(*)::int` })
          .from(approvalQueueEntries)
          .where(eq(approvalQueueEntries.draftId, adminDraft.id));
        assert.equal(adminQueues[0]?.count, 0);
        const adminAudits = await database
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.action, "admin_policy_submitted"),
              eq(auditEvents.entityId, policy.id),
            ),
          );
        assert.equal(adminAudits.length, 1);

        const inactiveReferenceDraft = await createOwnDraft(
          database,
          employeeContext,
          validInput(references, { policyNumber: "INACTIVE-REFERENCE" }),
          new Date("2026-07-10T07:00:00.000Z"),
        );
        await database
          .update(carriers)
          .set({ isActive: false })
          .where(eq(carriers.id, references.carrierId));
        await assert.rejects(
          submitOwnDraft(
            database,
            employeeContext,
            inactiveReferenceDraft.id,
            new Date("2026-07-10T08:00:00.000Z"),
          ),
          DraftInputValidationError,
        );
        const [unchangedReferenceDraft] = await database
          .select()
          .from(drafts)
          .where(eq(drafts.id, inactiveReferenceDraft.id));
        assert.equal(unchangedReferenceDraft?.status, "draft");
        await database
          .update(carriers)
          .set({ isActive: true })
          .where(eq(carriers.id, references.carrierId));

        const staleDraft = await createOwnDraft(
          database,
          employeeContext,
          validInput(references, { policyNumber: "STALE-SUBMISSION" }),
          new Date("2026-07-10T12:00:00.000Z"),
        );
        await assert.rejects(
          submitOwnDraft(
            database,
            employeeContext,
            staleDraft.id,
            new Date("2026-07-10T11:00:00.000Z"),
          ),
          DraftNotSubmittableError,
        );
        const [unchangedStaleDraft] = await database
          .select()
          .from(drafts)
          .where(eq(drafts.id, staleDraft.id));
        assert.equal(unchangedStaleDraft?.status, "draft");

        await verifyAuditRollback(
          pool,
          database,
          employeeContext,
          adminContext,
          references,
        );
      } finally {
        await pool.end();
      }
    },
  );
});

interface References {
  carrierId: string;
  mgaId: string;
  officeLocationId: string;
  policyTypeId: string;
}

async function createReferences(
  database: ReturnType<typeof drizzle<typeof databaseSchema>>,
): Promise<References> {
  const suffix = randomUUID();
  const [carrier] = await database
    .insert(carriers)
    .values({ name: `Submit Carrier ${suffix}` })
    .returning();
  const [mga] = await database
    .insert(mgas)
    .values({ name: `Submit MGA ${suffix}` })
    .returning();
  const [office] = await database
    .insert(officeLocations)
    .values({ name: `Submit Office ${suffix}` })
    .returning();
  const [policyType] = await database
    .insert(policyTypes)
    .values({ classTag: "Commercial", name: `Submit Type ${suffix}` })
    .returning();
  assert.ok(carrier && mga && office && policyType);
  return {
    carrierId: carrier.id,
    mgaId: mga.id,
    officeLocationId: office.id,
    policyTypeId: policyType.id,
  };
}

function validInput(
  references: References,
  input: Partial<CreateDraftRequest> = {},
): CreateDraftRequest {
  return {
    accountAssignment: "none",
    amountPaid: "500.00",
    basePremium: "1000.00",
    brokerFee: "50.00",
    carrierId: references.carrierId,
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "10.0000",
    effectiveDate: "2026-07-10",
    expirationDate: "2027-07-10",
    insuredName: "Submission Insured",
    mgaFee: "0.00",
    mgaId: references.mgaId,
    officeLocationId: references.officeLocationId,
    paymentMode: "full",
    policyNumber: `SUBMIT-${randomUUID()}`,
    policyTypeId: references.policyTypeId,
    proposalTotal: "1080.00",
    taxes: "30.00",
    transactionType: "New",
    ...input,
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

async function verifyAuditRollback(
  pool: pg.Pool,
  database: ReturnType<typeof drizzle<typeof databaseSchema>>,
  employeeContext: AuthorizedRequestContext,
  adminContext: AuthorizedRequestContext,
  references: References,
): Promise<void> {
  const staffDraft = await createOwnDraft(
    database,
    employeeContext,
    validInput(references, { policyNumber: "AUDIT-FAIL-STAFF" }),
    new Date("2026-07-10T09:00:00.000Z"),
  );
  const adminDraft = await createOwnDraft(
    database,
    adminContext,
    validInput(references, { policyNumber: "AUDIT-FAIL-ADMIN" }),
    new Date("2026-07-10T09:00:00.000Z"),
  );
  await pool.query(`
    CREATE FUNCTION fail_draft_submission_audit_for_test()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.action IN ('draft_submitted', 'admin_policy_submitted') THEN
        RAISE EXCEPTION 'forced draft submission audit failure'
          USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await pool.query(`
    CREATE TRIGGER fail_draft_submission_audit_for_test_trigger
    BEFORE INSERT ON audit_events
    FOR EACH ROW
    EXECUTE FUNCTION fail_draft_submission_audit_for_test()
  `);
  try {
    await assert.rejects(
      submitOwnDraft(
        database,
        employeeContext,
        staffDraft.id,
        new Date("2026-07-10T10:00:00.000Z"),
      ),
      (error: unknown) => readDatabaseErrorCode(error) === "55000",
    );
    await assert.rejects(
      submitOwnDraft(
        database,
        adminContext,
        adminDraft.id,
        new Date("2026-07-10T10:00:00.000Z"),
      ),
      (error: unknown) => readDatabaseErrorCode(error) === "55000",
    );
  } finally {
    await pool.query(
      "DROP TRIGGER fail_draft_submission_audit_for_test_trigger ON audit_events",
    );
    await pool.query("DROP FUNCTION fail_draft_submission_audit_for_test() ");
  }

  const rolledBackDrafts = await database
    .select({ id: drafts.id, status: drafts.status })
    .from(drafts)
    .where(sql`${drafts.id} IN (${staffDraft.id}, ${adminDraft.id})`);
  assert.deepEqual(
    rolledBackDrafts.map(({ status }) => status).sort(),
    ["draft", "draft"],
  );
  const queueCount = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(approvalQueueEntries)
    .where(eq(approvalQueueEntries.draftId, staffDraft.id));
  assert.equal(queueCount[0]?.count, 0);
  const policyCount = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(policies)
    .where(eq(policies.sourceDraftId, adminDraft.id));
  assert.equal(policyCount[0]?.count, 0);
}
