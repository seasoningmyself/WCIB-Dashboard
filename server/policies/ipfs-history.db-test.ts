import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { resetBusinessState } from "../business-state/service.js";
import { createUser } from "../auth/users.js";
import { createDatabasePool } from "../db/client.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "../db/policy-test-fixture.js";
import * as databaseSchema from "../db/schema.js";
import { policies, userCapabilities } from "../db/schema.js";
import { findPriorIpfsFinancing } from "./ipfs-history.js";

test("IPFS history exact-matches only active non-deleted financed policies", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for IPFS history test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_ipfs_history",
    async (isolatedUrl) => {
      const pool = createDatabasePool(isolatedUrl);
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const references = await createPolicyReferenceFixture(database);
        const admin = await createUser(database, {
          email: `ipfs-history-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const adminContext = context(admin.id, null, ["admin"]);
        const employeeContext = context(references.submittedByUserId, "employee");
        const producerContext = context(references.producerUserId, "producer");

        await database.insert(policies).values([
          financedPolicy(references, {
            approvedAt: new Date("2026-07-02T12:00:00.000Z"),
            insuredName: "Acme LLC",
            policyNumber: "IPFS-HISTORY-OLD",
          }),
          financedPolicy(references, {
            approvedAt: new Date("2026-07-03T12:00:00.000Z"),
            insuredName: "ACME LLC",
            policyNumber: "IPFS-HISTORY-LATEST",
          }),
        ]);
        const [deletedCandidate] = await database
          .insert(policies)
          .values(
            financedPolicy(references, {
              approvedAt: new Date("2026-07-04T12:00:00.000Z"),
              createdAt: new Date("2026-07-01T12:00:00.000Z"),
              insuredName: "Acme LLC",
              policyNumber: "IPFS-HISTORY-DELETED",
              updatedAt: new Date("2026-07-10T12:00:00.000Z"),
            }),
          )
          .returning({ id: policies.id, updatedAt: policies.updatedAt });
        assert.ok(deletedCandidate);
        await database.execute(sql`
          select soft_delete_policy(
            ${deletedCandidate.id}::uuid,
            ${admin.id}::uuid,
            ${"Test deleted history exclusion"}::text,
            ${deletedCandidate.updatedAt}::timestamp with time zone,
            ${new Date("2026-07-20T12:00:00.000Z")}::timestamp with time zone
          )
        `);

        for (const actor of [adminContext, employeeContext, producerContext]) {
          const result = await findPriorIpfsFinancing(
            database,
            actor,
            " acme llc ",
          );
          assert.equal(
            result.priorFinancing?.approvedAt.toISOString(),
            "2026-07-03T12:00:00.000Z",
          );
        }
        assert.equal(
          (await findPriorIpfsFinancing(database, employeeContext, "Acme  LLC"))
            .priorFinancing,
          null,
          "v15 exact matching does not collapse internal whitespace",
        );

        await resetBusinessState(
          database,
          adminContext,
          { clearKpiTargets: false, confirmation: "RESET" },
          new Date("2026-08-01T00:00:00.000Z"),
        );
        assert.equal(
          (await findPriorIpfsFinancing(database, producerContext, "Acme LLC"))
            .priorFinancing,
          null,
          "sealed-generation history must not affect active turn-ins",
        );

        await database.insert(policies).values(
          financedPolicy(references, {
            approvedAt: new Date("2026-08-02T12:00:00.000Z"),
            insuredName: "Acme LLC",
            policyNumber: "IPFS-HISTORY-CURRENT",
          }),
        );
        assert.equal(
          (await findPriorIpfsFinancing(database, employeeContext, "ACME LLC"))
            .priorFinancing?.approvedAt.toISOString(),
          "2026-08-02T12:00:00.000Z",
        );
      } finally {
        await pool.end();
      }
    },
  );
});

function financedPolicy(
  references: Awaited<ReturnType<typeof createPolicyReferenceFixture>>,
  overrides: Parameters<typeof policyTestInput>[1] = {},
) {
  return policyTestInput(references, {
    amountPaid: "300.00",
    basePremium: "1000.00",
    brokerFee: "0.00",
    commissionAmount: "100.00",
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "10.0000",
    financeBalance: "700.00",
    financeContact: {
      address: "10 Main Street",
      email: "insured@example.test",
      mobile: "555-0100",
    },
    financeMeta: { billingType: "invoice" },
    ipfsFinanced: "yes",
    ipfsReturning: "new",
    netDue: "200.00",
    paymentMode: "deposit",
    proposalTotal: "1000.00",
    sourceDraftId: null,
    ...overrides,
  });
}

function context(
  userId: string,
  staffRole: "employee" | "producer" | null,
  capabilities: readonly "admin"[] = [],
) {
  return {
    principal: { capabilities, staffRole, userActive: true, userId },
  } as const;
}
