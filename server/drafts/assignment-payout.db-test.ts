import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  buildAssignmentChoices,
  type AssignmentChoice,
} from "../../client/src/drafts/turn-in-state.js";
import type { CurrentUser } from "../../shared/current-user.js";
import type { CreateDraftRequest } from "../../shared/drafts.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import { approvePendingSubmission } from "../approval-queue/approve.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  createPolicyReferenceFixture,
  type PolicyReferenceFixture,
} from "../db/policy-test-fixture.js";
import {
  approvalQueueEntries,
  paySheetPolicies,
  paySheets,
  policies,
  producerRateHistory,
  userCapabilities,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { StructuredLogger } from "../logging/logger.js";
import {
  getPaySheetSource,
  projectAdminPaySheetDetail,
} from "../pay-sheets/read.js";
import { changeMgaPayableState } from "../policies/mga-payable-state.js";
import { createOwnDraft } from "./create.js";
import { submitOwnDraft } from "./submit.js";

test("v15 assignment choices persist through approval and produce the correct payouts", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for assignment payout test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_assign_payout",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 6 });
      const database = drizzle(pool, { schema: databaseSchema });
      const logger = new StructuredLogger({ write() {} });
      try {
        const references = await createPolicyReferenceFixture(database);
        const admin = await createUser(database, {
          email: `assignment-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const adminContext = context(admin.id, null, ["admin"]);
        const producerContext = context(
          references.producerUserId,
          "producer",
        );
        const producer: CurrentUser = {
          allowedNavigation: ["turn_in", "my_items", "my_commissions"],
          capabilities: [],
          displayName: "Kaylee",
          email: "kaylee-assignment@example.test",
          id: references.producerUserId,
          role: "producer",
        };
        const choices = buildAssignmentChoices(producer, []);
        assert.deepEqual(
          choices.map(({ accountAssignment, label, producerUserId }) => ({
            accountAssignment,
            label,
            producerUserId,
          })),
          [
            {
              accountAssignment: "none",
              label: "Sophia's account",
              producerUserId: null,
            },
            {
              accountAssignment: "book",
              label: "Kaylee's account",
              producerUserId: references.producerUserId,
            },
            {
              accountAssignment: "house",
              label: "1st-yr house - Kaylee",
              producerUserId: references.producerUserId,
            },
          ],
        );

        const openedAt = new Date("2026-07-01T00:00:00.000Z");
        const [sophiaSheet, producerSheet] = await database
          .insert(paySheets)
          .values([
            {
              createdAt: openedAt,
              openedAt,
              ownerType: "sophia",
              ownerUserId: admin.id,
              periodMonth: 7,
              periodYear: 2026,
              updatedAt: openedAt,
            },
            {
              createdAt: openedAt,
              openedAt,
              ownerType: "producer",
              ownerUserId: references.producerUserId,
              periodMonth: 7,
              periodYear: 2026,
              updatedAt: openedAt,
            },
          ])
          .returning();
        assert.ok(sophiaSheet && producerSheet);
        await database.insert(producerRateHistory).values({
          effectiveDate: "2000-01-01",
          newBrokerRate: "25.00",
          newCommissionRate: "25.00",
          producerUserId: references.producerUserId,
          renewalBrokerRate: "25.00",
          renewalCommissionRate: "25.00",
        });

        const approvedPolicies = [];
        for (const [index, choice] of choices.entries()) {
          const createdAt = new Date(`2026-07-10T0${index + 1}:00:00.000Z`);
          const draft = await createOwnDraft(
            database,
            producerContext,
            draftInput(references, choice, index),
            createdAt,
          );
          await submitOwnDraft(
            database,
            producerContext,
            draft.id,
            new Date(createdAt.getTime() + 60_000),
          );
          const [queueEntry] = await database
            .select({ id: approvalQueueEntries.id })
            .from(approvalQueueEntries)
            .where(eq(approvalQueueEntries.draftId, draft.id));
          assert.ok(queueEntry);
          const policy = await approvePendingSubmission(
            database,
            adminContext,
            queueEntry.id,
            new Date(createdAt.getTime() + 120_000),
          );
          assert.equal(policy.accountAssignment, choice.accountAssignment);
          assert.equal(policy.kayleeSplit, choice.accountAssignment);
          assert.equal(policy.producerUserId, choice.producerUserId);
          approvedPolicies.push(policy);
        }

        for (const [index, policy] of approvedPolicies.entries()) {
          await changeMgaPayableState(
            database,
            adminContext,
            policy.id,
            { reference: null, status: "paid" },
            logger,
            new Date(`2026-07-11T0${index + 1}:00:00.000Z`),
          );
        }

        const producerDetail = projectAdminPaySheetDetail(
          await getPaySheetSource(database, adminContext, producerSheet.id),
          adminContext,
        );
        const sophiaDetail = projectAdminPaySheetDetail(
          await getPaySheetSource(database, adminContext, sophiaSheet.id),
          adminContext,
        );
        assert.ok(producerDetail && sophiaDetail);
        const producerPayouts = new Map(
          producerDetail.policies.map(({ insuredName, producerPayout }) => [
            insuredName,
            producerPayout,
          ]),
        );
        assert.deepEqual(
          choices.map(({ label }) => ({
            classification: label,
            producerPayout: producerPayouts.get(label) ?? "0.00",
          })),
          [
            { classification: "Sophia's account", producerPayout: "0.00" },
            { classification: "Kaylee's account", producerPayout: "250.00" },
            { classification: "1st-yr house - Kaylee", producerPayout: "250.00" },
          ],
        );
        assert.deepEqual(
          Object.fromEntries(
            sophiaDetail.policies.map(({ insuredName, sophiaShare }) => [
              insuredName,
              sophiaShare,
            ]),
          ),
          {
            "1st-yr house - Kaylee": "750.00",
            "Sophia's account": "1000.00",
            "Kaylee's account": "750.00",
          },
        );
        const producerAssociations = await database
          .select({ policyId: paySheetPolicies.policyId })
          .from(paySheetPolicies)
          .where(eq(paySheetPolicies.paySheetId, producerSheet.id));
        assert.deepEqual(
          producerAssociations.map(({ policyId }) => policyId).sort(),
          approvedPolicies
            .filter(({ kayleeSplit }) => kayleeSplit !== "none")
            .map(({ id }) => id)
            .sort(),
        );
        const storedPolicies = await database
          .select({
            accountAssignment: policies.accountAssignment,
            insuredName: policies.insuredName,
            kayleeSplit: policies.kayleeSplit,
            producerUserId: policies.producerUserId,
          })
          .from(policies);
        assert.deepEqual(
          storedPolicies
            .map(({ insuredName, ...values }) => ({
              insuredName,
              ...values,
            }))
            .sort((left, right) => left.insuredName.localeCompare(right.insuredName)),
          [
            {
              accountAssignment: "house",
              insuredName: "1st-yr house - Kaylee",
              kayleeSplit: "house",
              producerUserId: references.producerUserId,
            },
            {
              accountAssignment: "book",
              insuredName: "Kaylee's account",
              kayleeSplit: "book",
              producerUserId: references.producerUserId,
            },
            {
              accountAssignment: "none",
              insuredName: "Sophia's account",
              kayleeSplit: "none",
              producerUserId: null,
            },
          ],
        );
      } finally {
        await pool.end();
      }
    },
  );
});

function draftInput(
  references: PolicyReferenceFixture,
  choice: AssignmentChoice,
  index: number,
): CreateDraftRequest {
  return {
    accountAssignment: choice.accountAssignment,
    amountPaid: "10000.00",
    basePremium: "10000.00",
    brokerFee: "0.00",
    carrierId: references.carrierId,
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "10.0000",
    effectiveDate: "2026-07-10",
    expirationDate: "2027-07-10",
    insuredName: choice.label,
    mgaFee: "0.00",
    mgaId: references.mgaId,
    officeLocationId: references.officeLocationId,
    paymentMode: "full",
    policyNumber: `ASSIGNMENT-${index + 1}`,
    policyTypeId: references.policyTypeId,
    producerUserId: choice.producerUserId,
    proposalTotal: "10000.00",
    taxes: "0.00",
    transactionType: "New",
  };
}

function context(
  userId: string,
  staffRole: "employee" | "producer" | null,
  capabilities: readonly "admin"[] = [],
): AuthorizedRequestContext {
  return {
    principal: {
      capabilities,
      staffRole,
      userActive: true,
      userId,
    },
  };
}
