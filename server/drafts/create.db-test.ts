import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import { approvePendingSubmission } from "../approval-queue/approve.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  carriers,
  drafts,
  mgas,
  officeLocations,
  policyTypes,
  staffProfiles,
  userCapabilities,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import {
  createOwnDraft,
  DraftInputValidationError,
  DraftLimitReachedError,
  MAX_CONTENT_BEARING_DRAFTS_PER_USER,
} from "./create.js";
import { DraftAccessDeniedError } from "./access.js";
import { flagOwnDraft } from "./flag.js";
import { projectDraftForAuthorizedContext } from "./projection.js";
import { submitOwnDraft } from "./submit.js";
import { sendBackFlaggedHelp } from "../approval-queue/send-back.js";

test("own draft creation enforces UUID ownership, active references, and clean defaults", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for draft creation test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_draft_create",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const employee = await createUser(database, {
          email: `draft-employee-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        const producer = await createUser(database, {
          email: `draft-producer-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        const admin = await createUser(database, {
          email: `draft-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(staffProfiles).values([
          {
            displayName: "Draft Employee",
            role: "employee",
            userId: employee.id,
          },
          {
            displayName: "Draft Producer",
            role: "producer",
            userId: producer.id,
          },
        ]);
        const [carrier] = await database
          .insert(carriers)
          .values({ name: `Carrier ${randomUUID()}` })
          .returning();
        const [inactiveCarrier] = await database
          .insert(carriers)
          .values({ isActive: false, name: `Inactive ${randomUUID()}` })
          .returning();
        const [mga] = await database
          .insert(mgas)
          .values({ name: `MGA ${randomUUID()}` })
          .returning();
        const [office] = await database
          .insert(officeLocations)
          .values({ name: `Office ${randomUUID()}` })
          .returning();
        const [policyType] = await database
          .insert(policyTypes)
          .values({
            classTag: "Commercial",
            name: `Policy Type ${randomUUID()}`,
          })
          .returning();
        assert.ok(carrier && inactiveCarrier && mga && office && policyType);

        const createdAt = new Date("2026-07-11T04:00:00.000Z");
        const employeeContext = context(employee.id, "employee");
        const employeeDraft = await createOwnDraft(
          database,
          employeeContext,
          {
            accountAssignment: "book",
            amountPaid: "300.00",
            basePremium: "1000.00",
            brokerFee: "50.00",
            carrierId: carrier.id,
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
            financeReference: "FIN-1",
            insuredName: "Test Insured",
            ipfsFinanced: "yes",
            ipfsReturning: "new",
            mgaFee: "25.00",
            mgaId: mga.id,
            officeLocationId: office.id,
            paymentMode: "deposit",
            policyNumber: "POL-1",
            policyTypeId: policyType.id,
            producerUserId: producer.id,
            proposalTotal: "1080.00",
            taxes: "5.00",
            transactionType: "New",
          },
          createdAt,
        );

        assert.equal(employeeDraft.ownerUserId, employee.id);
        assert.equal(employeeDraft.status, "draft");
        assert.equal(employeeDraft.schemaVersion, 1);
        assert.equal(employeeDraft.linkedPolicyId, null);
        assert.equal(employeeDraft.linkedQueueEntryId, null);
        assert.equal(employeeDraft.submittedAt, null);
        assert.equal(employeeDraft.netDue, "125.00");
        assert.equal(employeeDraft.financeBalance, "780.00");
        assert.deepEqual(employeeDraft.financeMeta, {
          billingType: "invoice",
          loanType: "commercial",
          minEarnedAmt: null,
          minEarnedPct: null,
        });
        const projected = projectDraftForAuthorizedContext(employeeDraft, {
          principal: employeeContext.principal,
        });
        assert.ok(projected && "agencyCommissionAmount" in projected);
        assert.equal(projected.agencyCommissionAmount, "125.00");

        const producerDraft = await createOwnDraft(
          database,
          context(producer.id, "producer"),
          {
            accountAssignment: "house",
            insuredName: "Producer Draft",
            producerUserId: producer.id,
          },
          createdAt,
        );
        assert.equal(producerDraft.ownerUserId, producer.id);
        assert.equal(producerDraft.producerUserId, producer.id);

        const adminDraft = await createOwnDraft(
          database,
          {
            principal: {
              capabilities: ["admin"],
              staffRole: null,
              userActive: true,
              userId: admin.id,
            },
          },
          {},
          createdAt,
        );
        assert.equal(adminDraft.ownerUserId, admin.id);
        assert.equal(adminDraft.status, "draft");

        await assert.rejects(
          createOwnDraft(
            database,
            employeeContext,
            { carrierId: inactiveCarrier.id },
            createdAt,
          ),
          DraftInputValidationError,
        );
        await assert.rejects(
          createOwnDraft(
            database,
            context(producer.id, "producer"),
            {
              accountAssignment: "book",
              producerUserId: employee.id,
            },
            createdAt,
          ),
          DraftInputValidationError,
        );
        await assert.rejects(
          createOwnDraft(
            database,
            {
              principal: {
                capabilities: [],
                staffRole: null,
                userActive: true,
                userId: admin.id,
              },
            },
            {},
            createdAt,
          ),
          DraftAccessDeniedError,
        );

        const count = await database
          .select({ count: sql<number>`count(*)::int` })
          .from(drafts);
        assert.equal(count[0]?.count, 3);
        const employeeRows = await database
          .select()
          .from(drafts)
          .where(eq(drafts.ownerUserId, employee.id));
        assert.deepEqual(employeeRows.map(({ id }) => id), [employeeDraft.id]);
      } finally {
        await pool.end();
      }
    },
  );
});

test("content-bearing draft cap is owner-scoped and concurrent-safe", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for draft cap test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_draft_cap",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const owner = await createUser(database, {
          email: `draft-cap-owner-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        const otherOwner = await createUser(database, {
          email: `draft-cap-other-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        const admin = await createUser(database, {
          email: `draft-cap-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database
          .insert(userCapabilities)
          .values({ capability: "admin", userId: admin.id });
        await database.insert(staffProfiles).values([
          {
            displayName: "Draft Cap Owner",
            role: "employee",
            userId: owner.id,
          },
          {
            displayName: "Other Draft Owner",
            role: "employee",
            userId: otherOwner.id,
          },
        ]);
        const [carrier] = await database
          .insert(carriers)
          .values({ name: `Cap Carrier ${randomUUID()}` })
          .returning();
        const [mga] = await database
          .insert(mgas)
          .values({ name: `Cap MGA ${randomUUID()}` })
          .returning();
        const [office] = await database
          .insert(officeLocations)
          .values({ name: `Cap Office ${randomUUID()}` })
          .returning();
        const [policyType] = await database
          .insert(policyTypes)
          .values({
            classTag: "Commercial",
            name: `Cap Policy Type ${randomUUID()}`,
          })
          .returning();
        assert.ok(carrier && mga && office && policyType);

        const references = {
          carrierId: carrier.id,
          mgaId: mga.id,
          officeLocationId: office.id,
          policyTypeId: policyType.id,
        };
        const ownerContext = context(owner.id, "employee");
        const adminContext: AuthorizedRequestContext = {
          principal: {
            capabilities: ["admin"],
            staffRole: null,
            userActive: true,
            userId: admin.id,
          },
        };
        const submitted = await createOwnDraft(
          database,
          ownerContext,
          completeDraftInput("Submitted cap fixture", references),
        );
        await submitOwnDraft(database, ownerContext, submitted.id);
        const approved = await createOwnDraft(
          database,
          ownerContext,
          completeDraftInput("Approved cap fixture", references),
        );
        const approvedSubmission = await submitOwnDraft(
          database,
          ownerContext,
          approved.id,
        );
        assert.ok(approvedSubmission.draft.linkedQueueEntryId);
        await approvePendingSubmission(
          database,
          adminContext,
          approvedSubmission.draft.linkedQueueEntryId,
        );
        const flagged = await createOwnDraft(database, ownerContext, {
          insuredName: "Flagged cap fixture",
        });
        await flagOwnDraft(database, ownerContext, flagged.id, {
          reason: "Needs help",
        });
        const sentBack = await createOwnDraft(database, ownerContext, {
          insuredName: "Sent-back cap fixture",
        });
        await flagOwnDraft(database, ownerContext, sentBack.id, {
          reason: "Needs help",
        });
        await sendBackFlaggedHelp(
          database,
          adminContext,
          sentBack.id,
          { reason: "Please revise" },
        );

        await database.insert(drafts).values([
          ...Array.from(
            { length: MAX_CONTENT_BEARING_DRAFTS_PER_USER - 1 },
            (_, index) => ({
              insuredName: `Open draft ${index + 1}`,
              ownerUserId: owner.id,
            }),
          ),
          { ownerUserId: owner.id },
        ]);

        const concurrent = await Promise.allSettled([
          createOwnDraft(database, context(owner.id, "employee"), {
            insuredName: "Concurrent A",
          }),
          createOwnDraft(database, context(owner.id, "employee"), {
            insuredName: "Concurrent B",
          }),
        ]);
        const fulfilled = concurrent.filter(
          (result) => result.status === "fulfilled",
        );
        const rejected = concurrent.filter(
          (result) => result.status === "rejected",
        );
        assert.equal(fulfilled.length, 1);
        assert.equal(rejected.length, 1);
        assert.ok(
          rejected[0]?.status === "rejected" &&
            rejected[0].reason instanceof DraftLimitReachedError,
        );

        await assert.rejects(
          createOwnDraft(database, context(owner.id, "employee"), {
            insuredName: "Over the cap",
          }),
          DraftLimitReachedError,
        );
        const empty = await createOwnDraft(
          database,
          context(owner.id, "employee"),
          {},
        );
        assert.equal(empty.insuredName, null);
        const other = await createOwnDraft(
          database,
          context(otherOwner.id, "employee"),
          { insuredName: "Other owner's first draft" },
        );
        assert.equal(other.ownerUserId, otherOwner.id);

        const countResult = await database.execute<{
          content_count: number;
          non_draft_count: number;
        }>(sql`
          SELECT
            count(*) FILTER (
              WHERE owner_user_id = ${owner.id}
                AND status = 'draft'
                AND insured_name IS NOT NULL
            )::int AS content_count,
            count(*) FILTER (
              WHERE owner_user_id = ${owner.id}
                AND status <> 'draft'
            )::int AS non_draft_count
          FROM drafts
        `);
        const counts = countResult.rows[0];
        assert.equal(
          counts?.content_count,
          MAX_CONTENT_BEARING_DRAFTS_PER_USER,
        );
        assert.equal(counts?.non_draft_count, 4);
      } finally {
        await pool.end();
      }
    },
  );
});

function completeDraftInput(
  insuredName: string,
  references: {
    carrierId: string;
    mgaId: string;
    officeLocationId: string;
    policyTypeId: string;
  },
) {
  return {
    accountAssignment: "none" as const,
    amountPaid: "1000.00",
    basePremium: "1000.00",
    brokerFee: "0.00",
    carrierId: references.carrierId,
    commissionConfirmed: true,
    commissionMode: "pct" as const,
    commissionRate: "10.0000",
    effectiveDate: "2026-07-01",
    expirationDate: "2027-07-01",
    insuredName,
    mgaFee: "0.00",
    mgaId: references.mgaId,
    officeLocationId: references.officeLocationId,
    paymentMode: "full" as const,
    policyNumber: `CAP-${randomUUID()}`,
    policyTypeId: references.policyTypeId,
    producerUserId: null,
    proposalTotal: "1000.00",
    taxes: "0.00",
    transactionType: "New",
  };
}

function context(
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
