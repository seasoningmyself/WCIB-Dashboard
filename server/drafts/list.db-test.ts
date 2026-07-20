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
import { flagDraftForHelp } from "../policies/lifecycle.js";
import { DraftAccessDeniedError } from "./access.js";
import { createOwnDraft } from "./create.js";
import { listOwnDrafts } from "./list.js";

test("own-draft listing scopes SQL by authenticated UUID and deterministic status order", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for draft list test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_draft_list",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const owner = await createUser(database, {
          displayName: "List Owner",
          email: `list-owner-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        const other = await createUser(database, {
          displayName: "List Other",
          email: `list-other-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        const admin = await createUser(database, {
          email: `list-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(staffProfiles).values([
          { role: "employee", userId: owner.id },
          { role: "employee", userId: other.id },
        ]);
        const ownerContext = staffContext(owner.id);
        const first = await createOwnDraft(
          database,
          ownerContext,
          { insuredName: "First" },
          new Date("2026-07-11T01:00:00.000Z"),
        );
        const second = await createOwnDraft(
          database,
          ownerContext,
          { insuredName: "Second" },
          new Date("2026-07-11T02:00:00.000Z"),
        );
        await flagDraftForHelp(
          database,
          ownerContext,
          first.id,
          "Need account classification help",
          new Date("2026-07-11T03:00:00.000Z"),
        );
        await createOwnDraft(
          database,
          staffContext(other.id),
          { insuredName: "Other user" },
          new Date("2026-07-11T04:00:00.000Z"),
        );

        const all = await listOwnDrafts(database, ownerContext, {});
        assert.deepEqual(
          all.map(({ id }) => id),
          [first.id, second.id],
        );
        assert.equal(all.every((draft) => draft.ownerUserId === owner.id), true);

        const flagged = await listOwnDrafts(database, ownerContext, {
          status: "flagged",
        });
        assert.deepEqual(flagged.map(({ id }) => id), [first.id]);

        const adminContext: AuthorizedRequestContext = {
          principal: {
            capabilities: ["admin"],
            staffRole: null,
            userActive: true,
            userId: admin.id,
          },
        };
        const adminDraft = await createOwnDraft(
          database,
          adminContext,
          { insuredName: "Admin own draft" },
          new Date("2026-07-11T05:00:00.000Z"),
        );
        const adminRows = await listOwnDrafts(database, adminContext, {});
        assert.deepEqual(adminRows.map(({ id }) => id), [adminDraft.id]);

        await assert.rejects(
          listOwnDrafts(database, ownerContext, {
            ownerUserId: other.id,
          }),
        );
        await assert.rejects(
          listOwnDrafts(
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
          ),
          DraftAccessDeniedError,
        );
      } finally {
        await pool.end();
      }
    },
  );
});

function staffContext(userId: string): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: [],
      staffRole: "employee",
      userActive: true,
      userId,
    },
  };
}
