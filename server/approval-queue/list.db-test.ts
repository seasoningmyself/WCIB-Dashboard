import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import { staffProfiles } from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import {
  flagDraftForHelp,
  PolicyLifecycleAccessError,
  submitDraftForApproval,
} from "../policies/lifecycle.js";
import { createOwnDraft } from "../drafts/create.js";
import { listApprovalWork } from "./list.js";

test("admin approval work composes pending snapshots and flagged drafts", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for approval work test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_approval_work",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const admin = await createUser(database, {
          email: `approval-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        const employee = await createUser(database, {
          email: `approval-employee-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        const producer = await createUser(database, {
          email: `approval-producer-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(staffProfiles).values([
          {
            displayName: "Approval Employee",
            role: "employee",
            userId: employee.id,
          },
          {
            displayName: "Approval Producer",
            role: "producer",
            userId: producer.id,
          },
        ]);
        const employeeContext = staffContext(employee.id, "employee");
        const producerContext = staffContext(producer.id, "producer");
        const pendingDraft = await createOwnDraft(
          database,
          employeeContext,
          { insuredName: "Pending Insured" },
          new Date("2026-07-11T01:00:00.000Z"),
        );
        const queueId = await submitDraftForApproval(
          database,
          employeeContext,
          pendingDraft.id,
          {
            basePremium: "1200.00",
            insuredName: "Pending Insured",
            schemaVersion: 1,
          },
          new Date("2026-07-11T02:00:00.000Z"),
        );
        const flaggedDraft = await createOwnDraft(
          database,
          producerContext,
          { basePremium: "900.00", insuredName: "Flagged Insured" },
          new Date("2026-07-11T03:00:00.000Z"),
        );
        await flagDraftForHelp(
          database,
          producerContext,
          flaggedDraft.id,
          "Need carrier help",
          new Date("2026-07-11T04:00:00.000Z"),
        );
        await createOwnDraft(
          database,
          employeeContext,
          { insuredName: "Still editing" },
          new Date("2026-07-11T05:00:00.000Z"),
        );

        const adminContext = context(admin.id, ["admin"]);
        const all = await listApprovalWork(database, adminContext, {});
        assert.deepEqual(all.submissions.map(({ entry }) => entry.id), [queueId]);
        assert.equal(all.submissions[0]?.submitterDisplayName, "Approval Employee");
        assert.deepEqual(all.helpRequests.map(({ draft }) => draft.id), [
          flaggedDraft.id,
        ]);
        assert.equal(
          all.helpRequests[0]?.submitterDisplayName,
          "Approval Producer",
        );

        const pending = await listApprovalWork(database, adminContext, {
          status: "pending",
        });
        assert.equal(pending.submissions.length, 1);
        assert.equal(pending.helpRequests.length, 0);
        const flagged = await listApprovalWork(database, adminContext, {
          status: "flagged",
        });
        assert.equal(flagged.submissions.length, 0);
        assert.equal(flagged.helpRequests.length, 1);

        await assert.rejects(
          listApprovalWork(database, employeeContext, {}),
          PolicyLifecycleAccessError,
        );
        await assert.rejects(
          listApprovalWork(database, producerContext, { status: "flagged" }),
          PolicyLifecycleAccessError,
        );
      } finally {
        await pool.end();
      }
    },
  );
});

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

function context(
  userId: string,
  capabilities: readonly "admin"[],
): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: [...capabilities],
      staffRole: null,
      userActive: true,
      userId,
    },
  };
}
