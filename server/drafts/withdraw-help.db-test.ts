import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import { auditEvents, staffProfiles } from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { createOwnDraft } from "./create.js";
import { flagOwnDraft } from "./flag.js";
import { projectDraftForAuthorizedContext } from "./projection.js";
import {
  DraftHelpWithdrawalNotAllowedError,
  DraftHelpWithdrawalNotFoundError,
  withdrawOwnFlaggedHelp,
} from "./withdraw-help.js";

test("owner withdrawal reopens flagged help through the audited transition", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for help withdrawal test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_help_withdraw",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 6 });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const employee = await createUser(database, {
          displayName: "Withdrawal Employee",
          email: `withdraw-employee-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        const producer = await createUser(database, {
          displayName: "Withdrawal Producer",
          email: `withdraw-producer-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(staffProfiles).values([
          { role: "employee", userId: employee.id },
          { role: "producer", userId: producer.id },
        ]);
        const ownerContext = staffContext(employee.id, "employee");
        const otherContext = staffContext(producer.id, "producer");
        const created = await createOwnDraft(
          database,
          ownerContext,
          {
            basePremium: "1000.00",
            brokerFee: "50.00",
            commissionConfirmed: true,
            commissionMode: "pct",
            commissionRate: "10.0000",
            insuredName: "Withdrawal Test",
            ipfsFinanced: "yes",
            paymentMode: "deposit",
          },
          new Date("2026-07-14T12:00:00.000Z"),
        );
        const flagged = await flagOwnDraft(
          database,
          ownerContext,
          created.id,
          { reason: "Need help before continuing" },
          new Date("2026-07-14T13:00:00.000Z"),
        );
        const flaggedProjection = projectDraftForAuthorizedContext(
          flagged,
          ownerContext,
        );
        assert.ok(flaggedProjection);
        assert.equal("basePremium" in flaggedProjection, false);
        assert.equal("ipfsFinanced" in flaggedProjection, false);

        await assert.rejects(
          withdrawOwnFlaggedHelp(
            database,
            otherContext,
            created.id,
            new Date("2026-07-14T14:00:00.000Z"),
          ),
          DraftHelpWithdrawalNotFoundError,
        );

        const reopened = await withdrawOwnFlaggedHelp(
          database,
          ownerContext,
          created.id,
          new Date("2026-07-14T14:00:00.000Z"),
        );
        assert.equal(reopened.status, "draft");
        assert.equal(reopened.flagReason, null);
        assert.equal(reopened.basePremium, "1000.00");
        assert.equal(reopened.ipfsFinanced, "yes");
        const reopenedProjection = projectDraftForAuthorizedContext(
          reopened,
          ownerContext,
        );
        assert.ok(reopenedProjection);
        assert.equal("basePremium" in reopenedProjection, true);
        assert.equal("ipfsFinanced" in reopenedProjection, true);
        assert.equal("agencyCommissionAmount" in reopenedProjection, true);
        if (!("basePremium" in reopenedProjection)) {
          assert.fail("reopened draft must use the active financial projection");
        }
        assert.equal(reopenedProjection.basePremium, "1000.00");
        assert.equal(reopenedProjection.ipfsFinanced, "yes");
        assert.equal(reopenedProjection.agencyCommissionAmount, "100.00");

        const events = await database
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.action, "draft_help_withdrawn"),
              eq(auditEvents.entityId, created.id),
            ),
          );
        assert.equal(events.length, 1);
        assert.equal(events[0]?.actorUserId, employee.id);
        assert.deepEqual(events[0]?.beforeSummary, { status: "flagged" });
        assert.deepEqual(events[0]?.afterSummary, { status: "draft" });

        await assert.rejects(
          withdrawOwnFlaggedHelp(database, ownerContext, created.id),
          DraftHelpWithdrawalNotAllowedError,
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
