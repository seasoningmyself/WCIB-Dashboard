import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import { listDeletedApprovalWork, restoreApprovalWork } from "../approval-queue/soft-delete.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  auditEvents,
  drafts,
  userCapabilities,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import { createPolicyReferenceFixture } from "../db/policy-test-fixture.js";
import { createOwnDraft } from "./create.js";
import {
  discardOwnDraft,
  DraftDiscardNotFoundError,
  DraftDiscardStaleError,
} from "./discard.js";
import { listOwnDrafts } from "./list.js";

const logger: AppLogger = { error() {}, info() {}, warn() {} };

test("owner draft discard is recoverable, audited, and rejects non-owners", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for owner draft discard test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_draft_discard",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 8 });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const references = await createPolicyReferenceFixture(database);
        const ownerContext = context(references.submittedByUserId, {
          staffRole: "employee",
        });
        const admin = await createUser(database, {
          email: `draft-discard-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const adminContext = context(admin.id, { capabilities: ["admin"] });
        const draft = await createOwnDraft(
          database,
          ownerContext,
          { insuredName: "Recoverable owner draft" },
          new Date("2026-07-17T10:00:00.000Z"),
        );

        await assert.rejects(
          discardOwnDraft(
            database,
            adminContext,
            draft.id,
            { expectedLastEditedAt: draft.lastEditedAt },
            new Date("2026-07-17T10:30:00.000Z"),
          ),
          DraftDiscardNotFoundError,
          "an admin cannot use the owner route to discard another user's draft",
        );
        await assert.rejects(
          discardOwnDraft(
            database,
            ownerContext,
            draft.id,
            { expectedLastEditedAt: new Date("2026-07-17T09:00:00.000Z") },
            new Date("2026-07-17T10:30:00.000Z"),
          ),
          DraftDiscardStaleError,
        );

        const discarded = await discardOwnDraft(
          database,
          ownerContext,
          draft.id,
          { expectedLastEditedAt: draft.lastEditedAt },
          new Date("2026-07-17T11:00:00.000Z"),
        );
        assert.equal(discarded.deletedByUserId, references.submittedByUserId);
        assert.equal(discarded.deleteReason, "Discarded by draft owner");
        assert.equal(
          (await listOwnDrafts(database, ownerContext, {})).some(
            ({ id }) => id === draft.id,
          ),
          false,
        );

        const deleted = await listDeletedApprovalWork(database, adminContext);
        assert.equal(
          deleted.some(
            (item) => item.kind === "draft" && item.draft.id === draft.id,
          ),
          true,
        );
        const [deleteAudit] = await database
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.entityId, draft.id),
              eq(auditEvents.action, "approval_work_soft_deleted"),
            ),
          );
        assert.equal(summaryKind(deleteAudit?.afterSummary), "draft");

        await restoreApprovalWork(
          database,
          adminContext,
          "draft",
          draft.id,
          { expectedUpdatedAt: discarded.lastEditedAt },
          logger,
          new Date("2026-07-17T12:00:00.000Z"),
        );
        const [restored] = await database
          .select()
          .from(drafts)
          .where(eq(drafts.id, draft.id));
        assert.ok(restored);
        assert.equal(restored.deletedAt, null);
        assert.equal(
          (await listOwnDrafts(database, ownerContext, {})).some(
            ({ id }) => id === draft.id,
          ),
          true,
        );
        const [restoreAudit] = await database
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.entityId, draft.id),
              eq(auditEvents.action, "approval_work_restored"),
            ),
          );
        assert.equal(summaryKind(restoreAudit?.afterSummary), "draft");
      } finally {
        await pool.end();
      }
    },
  );
});

function context(
  userId: string,
  input: Partial<AuthorizedRequestContext["principal"]> = {},
): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: [],
      staffRole: null,
      userActive: true,
      userId,
      ...input,
    },
  };
}

function summaryKind(value: unknown): unknown {
  return value !== null && typeof value === "object" && "kind" in value
    ? value.kind
    : undefined;
}
