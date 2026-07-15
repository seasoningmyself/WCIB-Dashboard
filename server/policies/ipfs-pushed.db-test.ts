import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { test } from "node:test";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import { createDatabasePool } from "../db/client.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
  type PolicyReferenceFixture,
} from "../db/policy-test-fixture.js";
import {
  auditEvents,
  policies,
  userCapabilities,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { StructuredLogger } from "../logging/logger.js";
import { softDeletePolicy } from "./soft-delete.js";
import { listIpfsWorkQueueSources } from "./ledger.js";
import {
  PolicyIpfsPushedNotFoundError,
  PolicyIpfsPushedValidationError,
  setPolicyIpfsPushedState,
} from "./ipfs-pushed.js";

const PASSWORD = "StrongPass123!";
const ORIGINAL_AT = new Date("2026-07-01T12:00:00.000Z");
const MARKED_AT = new Date("2026-07-14T12:00:00.000Z");
const UNMARKED_AT = new Date("2026-07-14T12:01:00.000Z");

test("IPFS pushed state is generation-scoped, queue-aware, idempotent, and audit-atomic", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for IPFS pushed-state test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_o_ipfs_push",
    async (isolatedUrl) => {
      const pool = createDatabasePool(isolatedUrl);
      const database = drizzle(pool, { schema: databaseSchema });
      const logger = new StructuredLogger({ write() {} });
      try {
        const references = await createPolicyReferenceFixture(database);
        const admin = await createUser(database, {
          email: `parent-o-admin-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const adminContext = context(admin.id, null, ["admin"]);
        const [automatic, manual, notIpfs, deleted] = await database
          .insert(policies)
          .values([
            financedPolicy(references, {
              insuredName: "Parent O Automatic",
              policyNumber: "PARENT-O-AUTO",
            }),
            financedPolicy(references, {
              financeContact: null,
              insuredName: "Parent O Manual",
              ipfsManual: true,
              ipfsReturning: null,
              policyNumber: "PARENT-O-MANUAL",
            }),
            policyTestInput(references, {
              createdAt: ORIGINAL_AT,
              insuredName: "Parent O Full Pay",
              policyNumber: "PARENT-O-FULL",
              sourceDraftId: null,
              updatedAt: ORIGINAL_AT,
            }),
            financedPolicy(references, {
              insuredName: "Parent O Deleted",
              policyNumber: "PARENT-O-DELETED",
            }),
          ])
          .returning();
        assert.ok(automatic && manual && notIpfs && deleted);

        await softDeletePolicy(
          database,
          adminContext,
          deleted.id,
          {
            expectedUpdatedAt: deleted.updatedAt.toISOString(),
            reason: "Test active-record exclusion",
          },
          logger,
          MARKED_AT,
        );

        assert.deepEqual(
          (await listIpfsWorkQueueSources(database, adminContext)).map(
            ({ policy }) => policy.id,
          ),
          [automatic.id],
        );

        const marked = await setPolicyIpfsPushedState(
          database,
          adminContext,
          automatic.id,
          {
            expectedUpdatedAt: automatic.updatedAt.toISOString(),
            pushed: true,
          },
          logger,
          MARKED_AT,
        );
        assert.equal(marked.changed, true);
        assert.equal(marked.source.policy.ipfsPushed, true);
        assert.equal(
          marked.source.policy.ipfsPushedAt?.toISOString(),
          MARKED_AT.toISOString(),
        );
        assert.deepEqual(
          (await listIpfsWorkQueueSources(database, adminContext)).map(
            ({ policy }) => policy.id,
          ),
          [],
        );
        assert.deepEqual(await ipfsAuditActions(database, automatic.id), [
          "policy_ipfs_pushed",
        ]);

        const retry = await setPolicyIpfsPushedState(
          database,
          adminContext,
          automatic.id,
          {
            expectedUpdatedAt: automatic.updatedAt.toISOString(),
            pushed: true,
          },
          logger,
          new Date("2026-07-14T12:00:30.000Z"),
        );
        assert.equal(retry.changed, false);
        assert.deepEqual(await ipfsAuditActions(database, automatic.id), [
          "policy_ipfs_pushed",
        ]);

        const unmarked = await setPolicyIpfsPushedState(
          database,
          adminContext,
          automatic.id,
          {
            expectedUpdatedAt: MARKED_AT.toISOString(),
            pushed: false,
          },
          logger,
          UNMARKED_AT,
        );
        assert.equal(unmarked.changed, true);
        assert.equal(unmarked.source.policy.ipfsPushed, false);
        assert.equal(unmarked.source.policy.ipfsPushedAt, null);
        assert.deepEqual(await ipfsAuditActions(database, automatic.id), [
          "policy_ipfs_pushed",
          "policy_ipfs_unpushed",
        ]);
        assert.deepEqual(
          (await listIpfsWorkQueueSources(database, adminContext)).map(
            ({ policy }) => policy.id,
          ),
          [automatic.id],
        );

        const manualMarked = await setPolicyIpfsPushedState(
          database,
          adminContext,
          manual.id,
          {
            expectedUpdatedAt: manual.updatedAt.toISOString(),
            pushed: true,
          },
          logger,
          MARKED_AT,
        );
        assert.equal(manualMarked.changed, true);
        assert.equal(manualMarked.source.policy.ipfsManual, true);
        assert.equal(manualMarked.source.policy.ipfsPushed, true);
        assert.deepEqual(
          (await listIpfsWorkQueueSources(database, adminContext)).map(
            ({ policy }) => policy.id,
          ),
          [automatic.id],
        );

        await assert.rejects(
          setPolicyIpfsPushedState(
            database,
            adminContext,
            notIpfs.id,
            {
              expectedUpdatedAt: notIpfs.updatedAt.toISOString(),
              pushed: true,
            },
            logger,
            MARKED_AT,
          ),
          PolicyIpfsPushedValidationError,
        );
        assert.deepEqual(await ipfsAuditActions(database, notIpfs.id), []);

        await assert.rejects(
          setPolicyIpfsPushedState(
            database,
            adminContext,
            deleted.id,
            {
              expectedUpdatedAt: MARKED_AT.toISOString(),
              pushed: true,
            },
            logger,
            UNMARKED_AT,
          ),
          PolicyIpfsPushedNotFoundError,
        );
        assert.deepEqual(await ipfsAuditActions(database, deleted.id), []);

        await forceAuditFailure(pool);
        const beforeFailure = await pushedState(database, automatic.id);
        await assert.rejects(
          setPolicyIpfsPushedState(
            database,
            adminContext,
            automatic.id,
            {
              expectedUpdatedAt: UNMARKED_AT.toISOString(),
              pushed: true,
            },
            logger,
            new Date("2026-07-14T12:02:00.000Z"),
          ),
          (error: unknown) => readDatabaseErrorCode(error) === "55000",
        );
        assert.deepEqual(await pushedState(database, automatic.id), beforeFailure);
        assert.deepEqual(await ipfsAuditActions(database, automatic.id), [
          "policy_ipfs_pushed",
          "policy_ipfs_unpushed",
        ]);
        await removeAuditFailure(pool);
      } finally {
        await pool.end();
      }
    },
  );
});

function financedPolicy(
  references: PolicyReferenceFixture,
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
    createdAt: ORIGINAL_AT,
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
    updatedAt: ORIGINAL_AT,
    ...overrides,
  });
}

function context(
  userId: string,
  staffRole: "employee" | "producer" | null,
  capabilities: readonly "admin"[] = [],
): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: [...capabilities],
      staffRole,
      userActive: true,
      userId,
    },
  };
}

async function ipfsAuditActions(
  database: ReturnType<typeof drizzle<typeof databaseSchema>>,
  policyId: string,
): Promise<string[]> {
  const rows = await database
    .select({ action: auditEvents.action })
    .from(auditEvents)
    .where(eq(auditEvents.entityId, policyId))
    .orderBy(auditEvents.occurredAt);
  return rows
    .map(({ action }) => action)
    .filter((action) => action.startsWith("policy_ipfs_"));
}

async function pushedState(
  database: ReturnType<typeof drizzle<typeof databaseSchema>>,
  policyId: string,
) {
  const [row] = await database
    .select({
      ipfsPushed: policies.ipfsPushed,
      ipfsPushedAt: policies.ipfsPushedAt,
      updatedAt: policies.updatedAt,
    })
    .from(policies)
    .where(eq(policies.id, policyId));
  assert.ok(row);
  return row;
}

async function forceAuditFailure(pool: ReturnType<typeof createDatabasePool>) {
  await pool.query(`
    CREATE FUNCTION fail_ipfs_pushed_audit_for_test()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.action IN ('policy_ipfs_pushed', 'policy_ipfs_unpushed') THEN
        RAISE EXCEPTION 'forced IPFS pushed audit failure'
          USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await pool.query(`
    CREATE TRIGGER fail_ipfs_pushed_audit_for_test_trigger
    BEFORE INSERT ON audit_events
    FOR EACH ROW EXECUTE FUNCTION fail_ipfs_pushed_audit_for_test()
  `);
}

async function removeAuditFailure(pool: ReturnType<typeof createDatabasePool>) {
  await pool.query(
    "DROP TRIGGER fail_ipfs_pushed_audit_for_test_trigger ON audit_events",
  );
  await pool.query("DROP FUNCTION fail_ipfs_pushed_audit_for_test() ");
}
