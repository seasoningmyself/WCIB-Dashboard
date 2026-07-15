import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createDatabasePool } from "../db/client.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "../db/policy-test-fixture.js";
import {
  auditEvents,
  carriers,
  mgas,
  policies,
  policyTypes,
  userCapabilities,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import type { AppLogger, LogContext } from "../logging/logger.js";
import { softDeletePolicy } from "../policies/soft-delete.js";
import { loadActiveVocabulary } from "./active.js";
import {
  AdminVocabularyAccessDeniedError,
  AdminVocabularyInUseError,
  loadAdminVocabularyManagementSource,
  setAdminVocabularyActive,
} from "./manage.js";

test("vocabulary management deactivates recoverably with live-ledger guards and atomic audit", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for vocabulary management test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_vocab_manage",
    async (isolatedUrl) => {
      const pool = createDatabasePool(isolatedUrl);
      const database = drizzle(pool, { schema: databaseSchema });
      const logs: LogContext[] = [];
      const logger: AppLogger = {
        error(_message, context) { logs.push(context ?? {}); },
        info(_message, context) { logs.push(context ?? {}); },
        warn(_message, context) { logs.push(context ?? {}); },
      };
      try {
        const references = await createPolicyReferenceFixture(database);
        const admin = context(references.submittedByUserId, "admin");
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: references.submittedByUserId,
        });
        const policyCreatedAt = new Date("2026-07-12T12:00:00.000Z");
        const [policy] = await database
          .insert(policies)
          .values(
            policyTestInput(references, {
              createdAt: policyCreatedAt,
              sourceDraftId: null,
              updatedAt: policyCreatedAt,
            }),
          )
          .returning();
        assert.ok(policy);
        const softDeletedAt = new Date(policy.updatedAt.getTime() + 1_000);

        const initial = await loadAdminVocabularyManagementSource(database, admin);
        assert.equal(find(initial.carriers, references.carrierId).inUse, true);
        assert.equal(find(initial.mgas, references.mgaId).inUse, true);
        assert.equal(find(initial.policyTypes, references.policyTypeId).inUse, true);
        for (const [kind, itemId] of [
          ["carrier", references.carrierId],
          ["mga", references.mgaId],
          ["policy_type", references.policyTypeId],
        ] as const) {
          await assert.rejects(
            setAdminVocabularyActive(
              database,
              admin,
              kind,
              itemId,
              { active: false },
              logger,
            ),
            AdminVocabularyInUseError,
          );
        }

        await softDeletePolicy(
          database,
          admin,
          policy.id,
          {
            expectedUpdatedAt: policy.updatedAt.toISOString(),
            reason: "Confirm soft-deleted policies do not pin vocabulary",
          },
          logger,
          softDeletedAt,
        );
        const ids = [references.carrierId, references.mgaId, references.policyTypeId];
        for (const [kind, itemId] of [
          ["carrier", references.carrierId],
          ["mga", references.mgaId],
          ["policy_type", references.policyTypeId],
        ] as const) {
          await setAdminVocabularyActive(
            database,
            admin,
            kind,
            itemId,
            { active: false },
            logger,
            new Date(softDeletedAt.getTime() + 1_000),
          );
        }
        const auditAfterDeactivate = await vocabularyAudits(database, ids);
        assert.equal(auditAfterDeactivate.length, 3);
        assert.equal(
          auditAfterDeactivate.every(
            (event) =>
              event.action === "vocabulary_deactivated" &&
              summaryActive(event.beforeSummary) === true &&
              summaryActive(event.afterSummary) === false,
          ),
          true,
        );

        await setAdminVocabularyActive(
          database,
          admin,
          "carrier",
          references.carrierId,
          { active: false },
          logger,
        );
        assert.equal((await vocabularyAudits(database, ids)).length, 3);
        const active = await loadActiveVocabulary(database);
        assert.equal(active.carriers.some(({ id }) => id === references.carrierId), false);
        assert.equal(active.mgas.some(({ id }) => id === references.mgaId), false);
        assert.equal(active.policyTypes.some(({ id }) => id === references.policyTypeId), false);

        for (const [kind, itemId] of [
          ["carrier", references.carrierId],
          ["mga", references.mgaId],
          ["policy_type", references.policyTypeId],
        ] as const) {
          await setAdminVocabularyActive(
            database,
            admin,
            kind,
            itemId,
            { active: true },
            logger,
            new Date(softDeletedAt.getTime() + 2_000),
          );
        }
        const allAudits = await vocabularyAudits(database, ids);
        assert.equal(allAudits.length, 6);
        assert.equal(
          allAudits.filter(({ action }) => action === "vocabulary_reactivated").length,
          3,
        );

        const failingName = `Audit failure carrier ${randomUUID()}`;
        const [failingCarrier] = await database
          .insert(carriers)
          .values({ name: failingName })
          .returning({ id: carriers.id });
        assert.ok(failingCarrier);
        await pool.query(`
          CREATE FUNCTION fail_vocabulary_state_audit()
          RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.action = 'vocabulary_deactivated' THEN
              RAISE EXCEPTION 'forced vocabulary state audit failure'
                USING ERRCODE = '55000';
            END IF;
            RETURN NEW;
          END;
          $$
        `);
        await pool.query(`
          CREATE TRIGGER fail_vocabulary_state_audit_trigger
          BEFORE INSERT ON audit_events
          FOR EACH ROW EXECUTE FUNCTION fail_vocabulary_state_audit()
        `);
        try {
          await assert.rejects(
            setAdminVocabularyActive(
              database,
              admin,
              "carrier",
              failingCarrier.id,
              { active: false },
              logger,
            ),
            (error: unknown) => readDatabaseErrorCode(error) === "55000",
          );
        } finally {
          await pool.query("DROP TRIGGER fail_vocabulary_state_audit_trigger ON audit_events");
          await pool.query("DROP FUNCTION fail_vocabulary_state_audit() ");
        }
        const [afterFailure] = await database
          .select({ isActive: carriers.isActive })
          .from(carriers)
          .where(eq(carriers.id, failingCarrier.id));
        assert.equal(afterFailure?.isActive, true);
        assert.equal((await vocabularyAudits(database, [failingCarrier.id])).length, 0);

        const employee = context(references.submittedByUserId, "employee");
        await assert.rejects(
          loadAdminVocabularyManagementSource(database, employee),
          AdminVocabularyAccessDeniedError,
        );
        await assert.rejects(
          setAdminVocabularyActive(
            database,
            employee,
            "carrier",
            failingCarrier.id,
            { active: false },
            logger,
          ),
          AdminVocabularyAccessDeniedError,
        );

        const serializedLogs = JSON.stringify(logs);
        assert.equal(serializedLogs.includes(failingName), false);
        assert.equal((await database.select().from(carriers)).length > 0, true);
        assert.equal((await database.select().from(mgas)).length > 0, true);
        assert.equal((await database.select().from(policyTypes)).length > 0, true);
      } finally {
        await pool.end();
      }
    },
  );
});

function context(
  userId: string,
  role: "admin" | "employee",
): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: role === "admin" ? ["admin"] : [],
      staffRole: role === "employee" ? "employee" : null,
      userActive: true,
      userId,
    },
  };
}

function find<T extends { id: string }>(items: readonly T[], id: string): T {
  const item = items.find((candidate) => candidate.id === id);
  assert.ok(item);
  return item;
}

async function vocabularyAudits(
  database: ReturnType<typeof drizzle<typeof databaseSchema>>,
  ids: readonly string[],
) {
  return database
    .select({
      action: auditEvents.action,
      afterSummary: auditEvents.afterSummary,
      beforeSummary: auditEvents.beforeSummary,
      entityId: auditEvents.entityId,
      entityType: auditEvents.entityType,
    })
    .from(auditEvents)
    .where(inArray(auditEvents.entityId, [...ids]));
}

function summaryActive(value: unknown): boolean | undefined {
  return typeof value === "object" && value !== null && "isActive" in value
    ? (value as { isActive?: boolean }).isActive
    : undefined;
}
