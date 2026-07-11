import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser, type AuthDatabase } from "../auth/users.js";
import { auditEvents, mgas } from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import type { AppLogger, LogContext } from "../logging/logger.js";
import {
  createMgaVocabulary,
  MgaAccessDeniedError,
} from "./mga-create.js";

test("MGA creation confirms near matches and atomically records its audit event", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for MGA creation database test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_mga_create",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 8 });
      const database = drizzle(pool, { schema: databaseSchema });
      const logs: LogContext[] = [];
      const logger: AppLogger = {
        error(_message, context) {
          logs.push(context ?? {});
        },
        info(_message, context) {
          logs.push(context ?? {});
        },
        warn(_message, context) {
          logs.push(context ?? {});
        },
      };

      try {
        const actor = await createUser(database, {
          email: `mga-creator-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        const context: AuthorizedRequestContext = {
          principal: {
            capabilities: ["admin"],
            staffRole: null,
            userActive: true,
            userId: actor.id,
          },
        };

        const existing = await createMgaVocabulary(
          database,
          context,
          { name: "ABCE" },
          logger,
        );
        assert.equal(existing.outcome, "created");

        const advisory = await createMgaVocabulary(
          database,
          context,
          { name: "ABCD" },
          logger,
        );
        assert.deepEqual(advisory, {
          candidates: [{ id: existing.item.id, name: "ABCE" }],
          outcome: "confirmation_required",
        });
        assert.equal(await countMgasByName(database, "ABCD"), 0);
        assert.equal(await countAuditEvents(database), 1);

        const confirmed = await createMgaVocabulary(
          database,
          context,
          { confirmNearDuplicate: true, name: "ABCD" },
          logger,
        );
        assert.equal(confirmed.outcome, "created");
        assert.equal(confirmed.item.name, "ABCD");

        const duplicate = await createMgaVocabulary(
          database,
          context,
          { confirmNearDuplicate: true, name: "abcd" },
          logger,
        );
        assert.deepEqual(duplicate, {
          item: confirmed.item,
          outcome: "duplicate",
        });
        assert.equal(await countAuditEvents(database), 2);

        const distinct = await createMgaVocabulary(
          database,
          context,
          { name: "WXYZ" },
          logger,
        );
        assert.equal(distinct.outcome, "created");

        const concurrentName = `Race MGA ${randomUUID()}`;
        const concurrent = await Promise.all([
          createMgaVocabulary(
            database,
            context,
            { name: concurrentName },
            logger,
          ),
          createMgaVocabulary(
            database,
            context,
            { name: concurrentName.toUpperCase() },
            logger,
          ),
        ]);
        assert.deepEqual(
          concurrent.map(({ outcome }) => outcome).sort(),
          ["created", "duplicate"],
        );
        assert.equal(await countMgasByName(database, concurrentName), 1);
        assert.equal(await countAuditEvents(database), 4);

        const failingName = `Audit Failure MGA ${randomUUID()}`;
        await pool.query(`
          CREATE FUNCTION fail_mga_audit_for_test()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF NEW.action = 'mga_created' THEN
              RAISE EXCEPTION 'forced MGA audit failure'
                USING ERRCODE = '55000';
            END IF;
            RETURN NEW;
          END;
          $$
        `);
        await pool.query(`
          CREATE TRIGGER fail_mga_audit_for_test_trigger
          BEFORE INSERT ON audit_events
          FOR EACH ROW
          EXECUTE FUNCTION fail_mga_audit_for_test()
        `);
        try {
          await assert.rejects(
            createMgaVocabulary(
              database,
              context,
              { name: failingName },
              logger,
            ),
            (error: unknown) => readDatabaseErrorCode(error) === "55000",
          );
        } finally {
          await pool.query(
            "DROP TRIGGER fail_mga_audit_for_test_trigger ON audit_events",
          );
          await pool.query("DROP FUNCTION fail_mga_audit_for_test() ");
        }
        assert.equal(await countMgasByName(database, failingName), 0);
        assert.equal(await countAuditEvents(database), 4);

        await assert.rejects(
          createMgaVocabulary(
            database,
            {
              principal: {
                capabilities: [],
                staffRole: "employee",
                userActive: true,
                userId: actor.id,
              },
            },
            { name: "Private MGA" },
            logger,
          ),
          MgaAccessDeniedError,
        );
        assert.equal(await countMgasByName(database, "Private MGA"), 0);

        const events = await database
          .select({
            action: auditEvents.action,
            actorUserId: auditEvents.actorUserId,
            afterSummary: auditEvents.afterSummary,
            entityType: auditEvents.entityType,
          })
          .from(auditEvents)
          .where(eq(auditEvents.action, "mga_created"));
        assert.equal(events.length, 4);
        assert.equal(
          events.every(
            (event) =>
              event.actorUserId === actor.id &&
              event.entityType === "mga" &&
              Object.keys(event.afterSummary ?? {}).join(",") === "name",
          ),
          true,
        );

        const serializedLogs = JSON.stringify(logs);
        for (const privateName of [
          "ABCE",
          "ABCD",
          "WXYZ",
          concurrentName,
          failingName,
          "Private MGA",
        ]) {
          assert.equal(serializedLogs.includes(privateName), false);
        }
      } finally {
        await pool.end();
      }
    },
  );
});

async function countMgasByName(
  database: AuthDatabase,
  name: string,
): Promise<number> {
  const [result] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(mgas)
    .where(sql`lower(${mgas.name}) = lower(${name})`);
  return result?.count ?? 0;
}

async function countAuditEvents(
  database: AuthDatabase,
): Promise<number> {
  const [result] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(auditEvents);
  return result?.count ?? 0;
}
