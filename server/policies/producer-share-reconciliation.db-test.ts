import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { test } from "node:test";
import { adminLedgerPolicySchema } from "../../shared/policy-ledger.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import { listMyCommissionSources } from "../commissions/read.js";
import { createDatabasePool } from "../db/client.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "../db/policy-test-fixture.js";
import {
  paySheets,
  policies,
  producerRateHistory,
  userCapabilities,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { StructuredLogger } from "../logging/logger.js";
import { closePaySheet } from "../pay-sheets/close.js";
import {
  getPaySheetSource,
  projectAdminPaySheetDetail,
} from "../pay-sheets/read.js";
import { syncMgaPaymentSheetPlacement } from "../pay-sheets/mga-placement.js";
import { setMgaPaymentState } from "./mga-payments.js";
import { applyPolicyCorrection } from "./corrections.js";
import {
  IPFS_WORK_QUEUE_HEADERS,
  renderIpfsWorkQueueCsv,
} from "./ipfs-work-queue-csv.js";
import {
  listIpfsWorkQueueSources,
  listPolicyLedger,
} from "./ledger.js";
import { projectAdminPolicy } from "./projection.js";

test("ledger, IPFS, pay sheets, and My Commissions share the frozen dated payout", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for producer-share reconciliation");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_share_recon",
    async (isolatedUrl) => {
      const pool = createDatabasePool(isolatedUrl);
      const database = drizzle(pool, { schema: databaseSchema });
      const logger = new StructuredLogger({ write() {} });
      try {
        const admin = await createUser(database, {
          email: `share-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const references = await createPolicyReferenceFixture(database);
        const adminContext = context(admin.id, null, ["admin"]);
        const producerContext = context(
          references.producerUserId,
          "producer",
        );
        const now = new Date();
        const approvedAt = new Date(now.getTime() - 60 * 60 * 1_000);
        const futureEffective = new Date(now);
        futureEffective.setUTCDate(futureEffective.getUTCDate() + 1);
        const futureAsOf = new Date(now);
        futureAsOf.setUTCDate(futureAsOf.getUTCDate() + 2);

        await database.insert(producerRateHistory).values({
          effectiveDate: "2000-01-01",
          newBrokerRate: "30.00",
          newCommissionRate: "30.00",
          producerUserId: references.producerUserId,
          renewalBrokerRate: "20.00",
          renewalCommissionRate: "20.00",
        });
        const [sophiaSheet, producerSheet] = await database
          .insert(paySheets)
          .values([
            {
              createdAt: now,
              openedAt: now,
              ownerType: "sophia",
              ownerUserId: admin.id,
              periodMonth: now.getUTCMonth() + 1,
              periodYear: now.getUTCFullYear(),
              updatedAt: now,
            },
            {
              createdAt: now,
              openedAt: now,
              ownerType: "producer",
              ownerUserId: references.producerUserId,
              periodMonth: now.getUTCMonth() + 1,
              periodYear: now.getUTCFullYear(),
              updatedAt: now,
            },
          ])
          .returning();
        assert.ok(sophiaSheet && producerSheet);

        const [policy] = await database
          .insert(policies)
          .values(
            policyTestInput(references, {
              accountAssignment: "book",
              amountPaid: "300.00",
              approvedAt,
              basePremium: "1000.00",
              brokerFee: "50.00",
              commissionAmount: "100.00",
              commissionConfirmed: true,
              commissionMode: "pct",
              commissionRate: "10.0000",
              createdAt: approvedAt,
              financeBalance: "750.00",
              financeContact: {
                address: "10 Main Street",
                email: "billing@example.test",
                mobile: "555-0100",
              },
              financeMeta: {
                billingType: "invoice",
                loanType: "commercial",
                minEarnedAmt: null,
                minEarnedPct: null,
              },
              insuredName: "Thirty Percent Reconciliation",
              ipfsFinanced: "yes",
              ipfsManual: false,
              ipfsPushed: false,
              ipfsReturning: "new",
              kayleeSplit: "book",
              netDue: "150.00",
              paymentMode: "deposit",
              policyNumber: "RATE-30",
              producerUserId: references.producerUserId,
              proposalTotal: "1050.00",
              sourceDraftId: null,
              submittedAt: approvedAt,
              transactionType: "New",
              updatedAt: approvedAt,
            }),
          )
          .returning();
        assert.ok(policy);
        await setMgaPaymentState(
          database,
          adminContext,
          policy.id,
          "paid",
          "RATE-30-PAID",
          logger,
          now,
        );
        await syncMgaPaymentSheetPlacement(
          database,
          adminContext,
          policy.id,
          true,
          logger,
          now,
        );
        await closePaySheet(
          database,
          adminContext,
          producerSheet.id,
          logger,
        );

        await database.insert(producerRateHistory).values({
          effectiveDate: futureEffective.toISOString().slice(0, 10),
          newBrokerRate: "40.00",
          newCommissionRate: "40.00",
          producerUserId: references.producerUserId,
          renewalBrokerRate: "35.00",
          renewalCommissionRate: "35.00",
        });
        const [currentPolicy] = await database
          .select({ updatedAt: policies.updatedAt })
          .from(policies)
          .where(eq(policies.id, policy.id))
          .limit(1);
        assert.ok(currentPolicy);
        // A later live assignment correction must not replace the paid snapshot.
        await applyPolicyCorrection(
          database,
          adminContext,
          policy.id,
          "Verify settled payout reconciliation",
          {
            accountAssignment: "none",
            kayleeSplit: "none",
            producerUserId: null,
          },
          ["accountAssignment", "producerUserId", "kayleeSplit"],
          currentPolicy.updatedAt,
          logger,
          futureEffective,
        );

        const paySheet = projectAdminPaySheetDetail(
          await getPaySheetSource(
            database,
            adminContext,
            producerSheet.id,
            futureAsOf,
          ),
          adminContext,
        );
        assert.ok(paySheet);
        const paySheetPayout = paySheet.policies.find(
          (item) => item.policyId === policy.id,
        )?.producerPayout;

        const commissions = await listMyCommissionSources(
          database,
          producerContext,
          {},
          futureAsOf,
        );
        const commissionPayout = commissions.items.find(
          (item) => item.id === policy.id,
        )?.payout;

        const month = approvedAt.toISOString().slice(0, 7);
        const ledger = await listPolicyLedger(
          database,
          adminContext,
          { month },
          futureAsOf,
        );
        const workQueue = await listIpfsWorkQueueSources(
          database,
          adminContext,
          futureAsOf,
        );
        const workItem = workQueue.find((item) => item.policy.id === policy.id);
        assert.ok(workItem);
        const projectedPolicy = projectAdminPolicy(
          workItem.policy,
          adminContext,
        );
        assert.ok(projectedPolicy);
        const csv = renderIpfsWorkQueueCsv([
          {
            labels: workItem.labels,
            policy: adminLedgerPolicySchema.parse(projectedPolicy),
            producerPayout: workItem.producerPayout,
            sophiaRetained: workItem.sophiaRetained,
          },
        ]);
        const csvValues = csv.split("\r\n")[1]?.split(",");
        assert.ok(csvValues);
        const csvPayout = csvValues[
          IPFS_WORK_QUEUE_HEADERS.indexOf("Producer share (WCIB internal)")
        ];
        const csvSophia = csvValues[
          IPFS_WORK_QUEUE_HEADERS.indexOf("Sophia retained (WCIB internal)")
        ];

        assert.deepEqual(
          {
            ipfsCsv: csvPayout,
            ledger: ledger.totals.producerPayout,
            myCommissions: commissionPayout,
            paySheet: paySheetPayout,
          },
          {
            ipfsCsv: "45.00",
            ledger: "45.00",
            myCommissions: "45.00",
            paySheet: "45.00",
          },
        );
        assert.equal(ledger.totals.agencyRevenue, "150.00");
        assert.equal(ledger.totals.commissionAmount, "100.00");
        assert.equal(ledger.totals.brokerFee, "50.00");
        assert.equal(ledger.totals.sophiaRetained, "105.00");
        assert.equal(csvSophia, "105.00");
      } finally {
        await pool.end();
      }
    },
  );
});

function context(
  userId: string,
  staffRole: "employee" | "producer" | null,
  capabilities: readonly string[] = [],
): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: [...capabilities],
      staffRole,
      userActive: true,
      userId,
    },
  } as AuthorizedRequestContext;
}
