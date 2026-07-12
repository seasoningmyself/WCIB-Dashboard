import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import {
  auditEvents,
  carriers,
  policyTypes,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import type { AppLogger, LogContext } from "../logging/logger.js";
import {
  createCarrierVocabulary,
  createPolicyTypeVocabulary,
  VocabularyAccessDeniedError,
} from "./create.js";

test("carrier and policy-type creation is duplicate-safe and atomically audited", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(
    databaseUrl,
    "DATABASE_URL is required for vocabulary creation database test",
  );

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_vocab_create",
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
          email: `vocabulary-creator-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        const context: AuthorizedRequestContext = {
          principal: {
            capabilities: [],
            staffRole: "employee",
            userActive: true,
            userId: actor.id,
          },
        };

        const carrier = await createCarrierVocabulary(
          database,
          context,
          { name: "  Test Carrier  " },
          logger,
        );
        const policyType = await createPolicyTypeVocabulary(
          database,
          context,
          { classTag: "Commercial", name: "  Test Policy Type  " },
          logger,
        );
        assert.equal(carrier.outcome, "created");
        assert.equal(carrier.item.name, "Test Carrier");
        assert.equal(policyType.outcome, "created");
        assert.deepEqual(policyType.item, {
          classTag: "Commercial",
          id: policyType.item.id,
          name: "Test Policy Type",
        });

        const createdEvents = await database
          .select()
          .from(auditEvents)
          .where(
            inArray(auditEvents.entityId, [carrier.item.id, policyType.item.id]),
          );
        assert.equal(createdEvents.length, 2);
        assert.deepEqual(
          createdEvents
            .map((event) => `${event.action}/${event.entityType}`)
            .sort(),
          ["carrier_created/carrier", "policy_type_created/policy_type"],
        );
        assert.equal(
          createdEvents.every((event) => event.actorUserId === actor.id),
          true,
        );
        assert.deepEqual(
          createdEvents.find((event) => event.entityId === carrier.item.id)
            ?.afterSummary,
          { name: "Test Carrier" },
        );
        assert.deepEqual(
          createdEvents.find((event) => event.entityId === policyType.item.id)
            ?.afterSummary,
          { classTag: "Commercial", name: "Test Policy Type" },
        );

        const duplicateCarrier = await createCarrierVocabulary(
          database,
          context,
          { name: "test carrier" },
          logger,
        );
        const duplicatePolicyType = await createPolicyTypeVocabulary(
          database,
          context,
          { classTag: "Personal", name: "TEST POLICY TYPE" },
          logger,
        );
        assert.deepEqual(duplicateCarrier, {
          item: carrier.item,
          outcome: "duplicate",
        });
        assert.deepEqual(duplicatePolicyType, {
          item: policyType.item,
          outcome: "duplicate",
        });

        const concurrentName = `Concurrent Carrier ${randomUUID()}`;
        const concurrentResults = await Promise.all([
          createCarrierVocabulary(
            database,
            context,
            { name: concurrentName },
            logger,
          ),
          createCarrierVocabulary(
            database,
            context,
            { name: concurrentName.toUpperCase() },
            logger,
          ),
        ]);
        assert.deepEqual(
          concurrentResults.map(({ outcome }) => outcome).sort(),
          ["created", "duplicate"],
        );
        const concurrentRows = await database
          .select({ id: carriers.id })
          .from(carriers)
          .where(sql`lower(${carriers.name}) = lower(${concurrentName})`);
        assert.equal(concurrentRows.length, 1);
        const concurrentEvents = await database
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.entityId, concurrentRows[0]?.id ?? ""));
        assert.deepEqual(
          concurrentEvents.map(({ action }) => action),
          ["carrier_created"],
        );

        const failingName = `Audit Failure Carrier ${randomUUID()}`;
        await pool.query(`
          CREATE FUNCTION fail_vocabulary_audit_for_test()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF NEW.action = 'carrier_created' THEN
              RAISE EXCEPTION 'forced vocabulary audit failure'
                USING ERRCODE = '55000';
            END IF;
            RETURN NEW;
          END;
          $$
        `);
        await pool.query(`
          CREATE TRIGGER fail_vocabulary_audit_for_test_trigger
          BEFORE INSERT ON audit_events
          FOR EACH ROW
          EXECUTE FUNCTION fail_vocabulary_audit_for_test()
        `);
        try {
          await assert.rejects(
            createCarrierVocabulary(
              database,
              context,
              { name: failingName },
              logger,
            ),
            (error: unknown) => readDatabaseErrorCode(error) === "55000",
          );
        } finally {
          await pool.query(
            "DROP TRIGGER fail_vocabulary_audit_for_test_trigger ON audit_events",
          );
          await pool.query("DROP FUNCTION fail_vocabulary_audit_for_test() ");
        }
        const failedRows = await database
          .select({ id: carriers.id })
          .from(carriers)
          .where(eq(carriers.name, failingName));
        assert.deepEqual(failedRows, []);

        const auditCount = await database
          .select({ count: sql<number>`count(*)::int` })
          .from(auditEvents);
        assert.equal(auditCount[0]?.count, 3);

        await assert.rejects(
          createCarrierVocabulary(
            database,
            {
              principal: {
                capabilities: [],
                staffRole: null,
                userActive: true,
                userId: actor.id,
              },
            },
            { name: "Denied Carrier" },
            logger,
          ),
          VocabularyAccessDeniedError,
        );
        const deniedRows = await database
          .select({ id: carriers.id })
          .from(carriers)
          .where(eq(carriers.name, "Denied Carrier"));
        assert.deepEqual(deniedRows, []);

        const serializedLogs = JSON.stringify(logs);
        for (const privateName of [
          "Test Carrier",
          "Test Policy Type",
          concurrentName,
          failingName,
        ]) {
          assert.equal(serializedLogs.includes(privateName), false);
        }
      } finally {
        await pool.end();
      }
    },
  );
});
