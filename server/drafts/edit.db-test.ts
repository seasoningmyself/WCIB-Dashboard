import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  carriers,
  drafts,
  staffProfiles,
  userCapabilities,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import {
  flagDraftForHelp,
  sendBackQueuedDraft,
  submitDraftForApproval,
} from "../policies/lifecycle.js";
import { createOwnDraft, DraftInputValidationError } from "./create.js";
import {
  DraftNotEditableError,
  DraftNotFoundError,
  editOwnDraft,
} from "./edit.js";

test("own-draft edits lock ownership and atomically reopen sent-back work", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for draft edit test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_draft_edit",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const owner = await createUser(database, {
          email: `edit-owner-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        const other = await createUser(database, {
          email: `edit-other-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        const producer = await createUser(database, {
          email: `edit-producer-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        const admin = await createUser(database, {
          email: `edit-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(staffProfiles).values([
          { displayName: "Edit Owner", role: "employee", userId: owner.id },
          { displayName: "Edit Other", role: "employee", userId: other.id },
          {
            displayName: "Edit Producer",
            role: "producer",
            userId: producer.id,
          },
        ]);
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const [inactiveCarrier] = await database
          .insert(carriers)
          .values({ isActive: false, name: `Inactive ${randomUUID()}` })
          .returning();
        assert.ok(inactiveCarrier);

        const ownerContext = staffContext(owner.id, "employee");
        const adminContext: AuthorizedRequestContext = {
          principal: {
            capabilities: ["admin"],
            staffRole: null,
            userActive: true,
            userId: admin.id,
          },
        };
        const active = await createOwnDraft(
          database,
          ownerContext,
          {
            basePremium: "1000.00",
            brokerFee: "50.00",
            commissionMode: "pct",
            commissionRate: "10.0000",
            insuredName: "Original",
          },
          new Date("2026-07-10T01:00:00.000Z"),
        );
        const edited = await editOwnDraft(
          database,
          ownerContext,
          active.id,
          { commissionRate: "12.5000", insuredName: "Updated" },
          new Date("2026-07-10T02:00:00.000Z"),
        );
        assert.equal(edited.previousStatus, "draft");
        assert.equal(edited.draft.ownerUserId, owner.id);
        assert.equal(edited.draft.insuredName, "Updated");
        assert.equal(edited.draft.commissionRate, "12.5000");
        assert.equal(edited.draft.id, active.id);
        assert.equal(
          edited.draft.createdAt.toISOString(),
          active.createdAt.toISOString(),
        );

        const sentBack = await createOwnDraft(
          database,
          ownerContext,
          { insuredName: "Needs correction" },
          new Date("2026-07-10T03:00:00.000Z"),
        );
        const queueId = await submitDraftForApproval(
          database,
          ownerContext,
          sentBack.id,
          { schemaVersion: 1, snapshot: "safe" },
          new Date("2026-07-10T04:00:00.000Z"),
        );
        await sendBackQueuedDraft(
          database,
          adminContext,
          queueId,
          "Correct the policy number",
          new Date("2026-07-10T05:00:00.000Z"),
        );
        const reopened = await editOwnDraft(
          database,
          ownerContext,
          sentBack.id,
          { policyNumber: "CORRECTED-1" },
          new Date("2026-07-10T06:00:00.000Z"),
        );
        assert.equal(reopened.previousStatus, "sent_back");
        assert.equal(reopened.draft.status, "draft");
        assert.equal(reopened.draft.policyNumber, "CORRECTED-1");
        assert.equal(reopened.draft.linkedQueueEntryId, null);
        assert.equal(reopened.draft.sentBackReason, "Correct the policy number");

        const rollbackDraft = await createOwnDraft(
          database,
          ownerContext,
          { insuredName: "Must remain" },
          new Date("2026-07-10T07:00:00.000Z"),
        );
        const rollbackQueueId = await submitDraftForApproval(
          database,
          ownerContext,
          rollbackDraft.id,
          { schemaVersion: 1, snapshot: "safe" },
          new Date("2026-07-10T08:00:00.000Z"),
        );
        await sendBackQueuedDraft(
          database,
          adminContext,
          rollbackQueueId,
          "Fix carrier",
          new Date("2026-07-10T09:00:00.000Z"),
        );
        await assert.rejects(
          editOwnDraft(
            database,
            ownerContext,
            rollbackDraft.id,
            { carrierId: inactiveCarrier.id, insuredName: "Must roll back" },
            new Date("2026-07-10T10:00:00.000Z"),
          ),
          DraftInputValidationError,
        );
        const [afterFailure] = await database
          .select()
          .from(drafts)
          .where(eq(drafts.id, rollbackDraft.id));
        assert.equal(afterFailure?.status, "sent_back");
        assert.equal(afterFailure?.insuredName, "Must remain");

        const flagged = await createOwnDraft(
          database,
          ownerContext,
          { insuredName: "Flagged" },
          new Date("2026-07-10T11:00:00.000Z"),
        );
        await flagDraftForHelp(
          database,
          ownerContext,
          flagged.id,
          "Need help",
          new Date("2026-07-10T12:00:00.000Z"),
        );
        await assert.rejects(
          editOwnDraft(database, ownerContext, flagged.id, {
            insuredName: "Forbidden edit",
          }),
          DraftNotEditableError,
        );
        await assert.rejects(
          editOwnDraft(database, staffContext(other.id, "employee"), active.id, {
            insuredName: "Horizontal edit",
          }),
          DraftNotFoundError,
        );
        await assert.rejects(
          editOwnDraft(database, ownerContext, active.id, {
            ownerUserId: other.id,
          }),
        );

        const producerDraft = await createOwnDraft(
          database,
          staffContext(producer.id, "producer"),
          {
            accountAssignment: "book",
            producerUserId: producer.id,
          },
        );
        const producerEdit = await editOwnDraft(
          database,
          staffContext(producer.id, "producer"),
          producerDraft.id,
          { basePremium: "500.00" },
        );
        assert.equal(producerEdit.draft.basePremium, "500.00");
        assert.equal(producerEdit.draft.ownerUserId, producer.id);
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
