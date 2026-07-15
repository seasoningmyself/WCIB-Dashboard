import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { test } from "node:test";
import { createUser } from "../auth/users.js";
import { resetBusinessState } from "../business-state/service.js";
import { createDatabasePool } from "../db/client.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "../db/policy-test-fixture.js";
import * as databaseSchema from "../db/schema.js";
import { policies, userCapabilities } from "../db/schema.js";
import { listIpfsWorkQueueSources } from "./ledger.js";

test("IPFS work queue includes only active pending non-manual IPFS policies", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for IPFS work-queue test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_ipfs_work_queue",
    async (isolatedUrl) => {
      const pool = createDatabasePool(isolatedUrl);
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const references = await createPolicyReferenceFixture(database);
        const admin = await createUser(database, {
          email: `ipfs-queue-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const context = adminContext(admin.id);

        await database.insert(policies).values(
          eligiblePolicy(references, "IPFS-ARCHIVED", "2026-07-10T12:00:00.000Z"),
        );
        await resetBusinessState(
          database,
          context,
          { clearKpiTargets: false, confirmation: "RESET" },
          new Date("2026-08-01T00:00:00.000Z"),
        );

        const [first, second] = await database
          .insert(policies)
          .values([
            eligiblePolicy(references, "IPFS-PENDING-B", "2026-08-03T12:00:00.000Z"),
            eligiblePolicy(references, "IPFS-PENDING-A", "2026-08-02T12:00:00.000Z"),
          ])
          .returning({ id: policies.id, policyNumber: policies.policyNumber });
        assert.ok(first && second);

        await database.insert(policies).values([
          eligiblePolicy(references, "IPFS-MANUAL", "2026-08-04T12:00:00.000Z", {
            ipfsManual: true,
          }),
          eligiblePolicy(references, "IPFS-PUSHED", "2026-08-05T12:00:00.000Z", {
            ipfsPushed: true,
            ipfsPushedAt: new Date("2026-08-05T13:00:00.000Z"),
          }),
          eligiblePolicy(references, "FINANCED-ELSEWHERE", "2026-08-06T12:00:00.000Z", {
            financeContact: null,
            financeMeta: null,
            ipfsFinanced: "no",
            ipfsReturning: null,
          }),
          eligiblePolicy(references, "FULL-PAYMENT", "2026-08-07T12:00:00.000Z", {
            financeBalance: "0.00",
            financeContact: null,
            financeMeta: null,
            ipfsFinanced: null,
            ipfsReturning: null,
            paymentMode: "full",
          }),
        ]);

        const [deletedCandidate] = await database
          .insert(policies)
          .values(
            eligiblePolicy(references, "IPFS-DELETED", "2026-08-08T12:00:00.000Z", {
              createdAt: new Date("2026-08-01T12:00:00.000Z"),
              updatedAt: new Date("2026-08-09T12:00:00.000Z"),
            }),
          )
          .returning({ id: policies.id, updatedAt: policies.updatedAt });
        assert.ok(deletedCandidate);
        await database.execute(sql`
          select soft_delete_policy(
            ${deletedCandidate.id}::uuid,
            ${admin.id}::uuid,
            ${"Exclude deleted work"}::text,
            ${deletedCandidate.updatedAt}::timestamp with time zone,
            ${new Date("2026-08-10T12:00:00.000Z")}::timestamp with time zone
          )
        `);

        const rows = await listIpfsWorkQueueSources(database, context);
        assert.deepEqual(
          rows.map(({ policy }) => policy.policyNumber),
          ["IPFS-PENDING-A", "IPFS-PENDING-B"],
        );
        assert.equal(rows.every(({ policy }) =>
          policy.paymentMode === "deposit" &&
          policy.ipfsFinanced === "yes" &&
          !policy.ipfsManual &&
          !policy.ipfsPushed &&
          policy.deletedAt === null
        ), true);
      } finally {
        await pool.end();
      }
    },
  );
});

function eligiblePolicy(
  references: Awaited<ReturnType<typeof createPolicyReferenceFixture>>,
  policyNumber: string,
  approvedAt: string,
  overrides: Parameters<typeof policyTestInput>[1] = {},
) {
  return policyTestInput(references, {
    amountPaid: "300.00",
    basePremium: "1000.00",
    brokerFee: "50.00",
    commissionAmount: "125.00",
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "12.5000",
    financeBalance: "775.00",
    financeContact: {
      address: "10 Main Street",
      email: "insured@example.test",
      mobile: "555-0100",
    },
    financeMeta: {
      billingType: "invoice",
      loanType: "commercial",
      minEarnedAmt: null,
      minEarnedPct: null,
    },
    ipfsFinanced: "yes",
    ipfsReturning: "new",
    mgaFee: "25.00",
    netDue: "125.00",
    paymentMode: "deposit",
    policyNumber,
    proposalTotal: "1075.00",
    sourceDraftId: null,
    approvedAt: new Date(approvedAt),
    ...overrides,
  });
}

function adminContext(userId: string) {
  return {
    principal: {
      capabilities: ["admin"] as const,
      staffRole: null,
      userActive: true,
      userId,
    },
  } as const;
}
