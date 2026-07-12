import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import {
  approvalQueueEntries,
  auditEvents,
  drafts,
  staffProfiles,
  userCapabilities,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { DraftAccessDeniedError } from "./access.js";
import { createOwnDraft } from "./create.js";
import {
  DraftFlagNotFoundError,
  DraftNotFlaggableError,
  flagOwnDraft,
} from "./flag.js";

test("help flags are owner-scoped, replay-safe, and atomically audited", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for draft flag test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_draft_flag",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 8 });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const employee = await createUser(database, {
          email: `flag-employee-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        const producer = await createUser(database, {
          email: `flag-producer-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        const admin = await createUser(database, {
          email: `flag-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(staffProfiles).values([
          {
            displayName: "Flag Employee",
            role: "employee",
            userId: employee.id,
          },
          {
            displayName: "Flag Producer",
            role: "producer",
            userId: producer.id,
          },
        ]);
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const employeeContext = staffContext(employee.id, "employee");
        const producerContext = staffContext(producer.id, "producer");
        const adminContext: AuthorizedRequestContext = {
          principal: {
            capabilities: ["admin"],
            staffRole: null,
            userActive: true,
            userId: admin.id,
          },
        };

        const employeeDraft = await createOwnDraft(
          database,
          employeeContext,
          {
            basePremium: "1000.00",
            commissionConfirmed: true,
            commissionMode: "pct",
            commissionRate: "10.0000",
            insuredName: "Needs Help",
          },
          new Date("2026-07-10T01:00:00.000Z"),
        );
        const flagged = await flagOwnDraft(
          database,
          employeeContext,
          employeeDraft.id,
          { reason: "  Need help choosing an MGA  " },
          new Date("2026-07-10T02:00:00.000Z"),
        );
        assert.equal(flagged.status, "flagged");
        assert.equal(flagged.flagReason, "Need help choosing an MGA");
        assert.equal(flagged.ownerUserId, employee.id);
        const events = await database
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.action, "draft_flagged"),
              eq(auditEvents.entityId, employeeDraft.id),
            ),
          );
        assert.equal(events.length, 1);
        assert.equal(events[0]?.actorUserId, employee.id);
        const helpQueues = await database
          .select({ count: sql<number>`count(*)::int` })
          .from(approvalQueueEntries)
          .where(eq(approvalQueueEntries.draftId, employeeDraft.id));
        assert.equal(helpQueues[0]?.count, 0);

        await assert.rejects(
          flagOwnDraft(
            database,
            employeeContext,
            employeeDraft.id,
            { reason: "Replay" },
          ),
          DraftNotFlaggableError,
        );
        await assert.rejects(
          flagOwnDraft(
            database,
            producerContext,
            employeeDraft.id,
            { reason: "Other owner" },
          ),
          DraftFlagNotFoundError,
        );
        await assert.rejects(
          flagOwnDraft(
            database,
            adminContext,
            employeeDraft.id,
            { reason: "Admin path" },
          ),
          DraftAccessDeniedError,
        );

        const concurrentDraft = await createOwnDraft(
          database,
          producerContext,
          { insuredName: "Concurrent Help" },
          new Date("2026-07-10T03:00:00.000Z"),
        );
        const concurrent = await Promise.allSettled([
          flagOwnDraft(
            database,
            producerContext,
            concurrentDraft.id,
            { reason: "First request" },
            new Date("2026-07-10T04:00:00.000Z"),
          ),
          flagOwnDraft(
            database,
            producerContext,
            concurrentDraft.id,
            { reason: "Second request" },
            new Date("2026-07-10T04:00:00.000Z"),
          ),
        ]);
        assert.equal(
          concurrent.filter(({ status }) => status === "fulfilled").length,
          1,
        );
        const rejected = concurrent.find(({ status }) => status === "rejected");
        assert.ok(rejected?.status === "rejected");
        assert.ok(rejected.reason instanceof DraftNotFlaggableError);
        const concurrentEvents = await database
          .select({ count: sql<number>`count(*)::int` })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.action, "draft_flagged"),
              eq(auditEvents.entityId, concurrentDraft.id),
            ),
          );
        assert.equal(concurrentEvents[0]?.count, 1);

        const staleDraft = await createOwnDraft(
          database,
          employeeContext,
          { insuredName: "Stale Help" },
          new Date("2026-07-10T06:00:00.000Z"),
        );
        await assert.rejects(
          flagOwnDraft(
            database,
            employeeContext,
            staleDraft.id,
            { reason: "Stale request" },
            new Date("2026-07-10T05:00:00.000Z"),
          ),
          DraftNotFlaggableError,
        );

        const rollbackDraft = await createOwnDraft(
          database,
          employeeContext,
          { insuredName: "Audit Rollback" },
          new Date("2026-07-10T07:00:00.000Z"),
        );
        await pool.query(`
          CREATE FUNCTION fail_draft_flag_audit_for_test()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF NEW.action = 'draft_flagged' THEN
              RAISE EXCEPTION 'forced draft flag audit failure'
                USING ERRCODE = '55000';
            END IF;
            RETURN NEW;
          END;
          $$
        `);
        await pool.query(`
          CREATE TRIGGER fail_draft_flag_audit_for_test_trigger
          BEFORE INSERT ON audit_events
          FOR EACH ROW
          EXECUTE FUNCTION fail_draft_flag_audit_for_test()
        `);
        try {
          await assert.rejects(
            flagOwnDraft(
              database,
              employeeContext,
              rollbackDraft.id,
              { reason: "Must roll back" },
              new Date("2026-07-10T08:00:00.000Z"),
            ),
            (error: unknown) => readDatabaseErrorCode(error) === "55000",
          );
        } finally {
          await pool.query(
            "DROP TRIGGER fail_draft_flag_audit_for_test_trigger ON audit_events",
          );
          await pool.query("DROP FUNCTION fail_draft_flag_audit_for_test() ");
        }
        const [rolledBack] = await database
          .select()
          .from(drafts)
          .where(eq(drafts.id, rollbackDraft.id));
        assert.equal(rolledBack?.status, "draft");
        assert.equal(rolledBack?.flagReason, null);
        const rollbackEvents = await database
          .select({ count: sql<number>`count(*)::int` })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.action, "draft_flagged"),
              eq(auditEvents.entityId, rollbackDraft.id),
            ),
          );
        assert.equal(rollbackEvents[0]?.count, 0);
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
