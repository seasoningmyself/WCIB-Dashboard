import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createUser } from "../auth/users.js";
import { withDisposableMigratedDatabase } from "./disposable-database-test-helper.js";
import { readDatabaseErrorCode } from "./error-code.js";
import { loadMigrationPlan } from "./migration-plan.js";
import { captureSchemaFingerprint } from "./migration-safety.js";
import { userCapabilities } from "./schema.js";
import * as databaseSchema from "./schema.js";

interface InitializationResult {
  created: boolean;
  ownerType: "producer" | "sophia";
  paySheetId: string;
  periodMonth: number;
  periodYear: number;
}

test("pay-sheet initialization is authorized, atomic, concurrent-safe, and idempotent", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for initialization test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_sheet_init",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 6 });
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const admin = await createUser(database, {
          email: `sheet-init-admin-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const employee = await createUser(database, {
          email: `sheet-init-employee-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        const openedAt = new Date("2026-06-01T12:00:00.000Z");

        const concurrent = await Promise.all([
          initialize(pool, admin.id, "sophia", 6, 2026, admin.id, openedAt),
          initialize(pool, admin.id, "sophia", 6, 2026, admin.id, openedAt),
        ]);
        assert.deepEqual(
          concurrent.map(({ created }) => created).sort(),
          [false, true],
        );
        assert.equal(concurrent[0]?.paySheetId, concurrent[1]?.paySheetId);
        assert.deepEqual(
          concurrent.map(({ periodMonth, periodYear }) => ({
            periodMonth,
            periodYear,
          })),
          [
            { periodMonth: 6, periodYear: 2026 },
            { periodMonth: 6, periodYear: 2026 },
          ],
        );
        assert.equal(await count(pool, "pay_sheets"), 1);
        assert.equal(
          await count(
            pool,
            "audit_events",
            "action = 'pay_sheet_initialized'::audit_action",
          ),
          1,
        );

        const retry = await initialize(
          pool,
          admin.id,
          "sophia",
          6,
          2026,
          admin.id,
          openedAt,
        );
        assert.equal(retry.created, false);
        assert.equal(retry.paySheetId, concurrent[0]?.paySheetId);
        assert.equal(await count(pool, "pay_sheets"), 1);
        assert.equal(
          await count(
            pool,
            "audit_events",
            "action = 'pay_sheet_initialized'::audit_action",
          ),
          1,
        );

        await expectCode("55000", () =>
          initialize(pool, admin.id, "sophia", 7, 2026, admin.id, openedAt),
        );
        await expectCode("42501", () =>
          initialize(
            pool,
            employee.id,
            "sophia",
            6,
            2026,
            employee.id,
            openedAt,
          ),
        );

        const failureOwner = await createUser(database, {
          email: `sheet-init-failure-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await pool.query(`
          CREATE FUNCTION fail_pay_sheet_initialization_audit_for_test()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF NEW.action = 'pay_sheet_initialized'::audit_action THEN
              RAISE EXCEPTION 'forced initialization audit failure'
                USING ERRCODE = '55000';
            END IF;
            RETURN NEW;
          END;
          $$
        `);
        await pool.query(`
          CREATE TRIGGER fail_pay_sheet_initialization_audit_for_test_trigger
          BEFORE INSERT ON audit_events
          FOR EACH ROW
          EXECUTE FUNCTION fail_pay_sheet_initialization_audit_for_test()
        `);
        await expectCode("55000", () =>
          initialize(
            pool,
            failureOwner.id,
            "producer",
            6,
            2026,
            admin.id,
            openedAt,
          ),
        );
        assert.equal(
          await ownerSheetCount(pool, failureOwner.id, "producer"),
          0,
        );
        assert.equal(
          await ownerInitializationAuditCount(pool, failureOwner.id),
          0,
        );
        await pool.query(
          "DROP TRIGGER fail_pay_sheet_initialization_audit_for_test_trigger ON audit_events",
        );
        await pool.query(
          "DROP FUNCTION fail_pay_sheet_initialization_audit_for_test()",
        );

        const brokenOwner = await createUser(database, {
          email: `sheet-init-broken-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await pool.query(
          `INSERT INTO pay_sheets (
             owner_user_id, owner_type, period_month, period_year, status,
             opened_at, closed_at, closed_by_user_id, created_at, updated_at
           ) VALUES (
             $1, 'producer', 5, 2026, 'closed', $2, $3, $4, $2, $3
           )`,
          [
            brokenOwner.id,
            new Date("2026-05-01T00:00:00.000Z"),
            new Date("2026-05-31T23:59:00.000Z"),
            admin.id,
          ],
        );
        await expectCode("55000", () =>
          initialize(
            pool,
            brokenOwner.id,
            "producer",
            6,
            2026,
            admin.id,
            openedAt,
          ),
        );
        assert.equal(await ownerSheetCount(pool, brokenOwner.id, "producer"), 1);
      } finally {
        await pool.end();
      }
    },
  );
});

test("pay-sheet initialization migration rolls back and reapplies byte-identically", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for migration test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_sheet_mig",
    async (isolatedUrl) => {
      const client = new pg.Client({ connectionString: isolatedUrl });
      await client.connect();
      const plan = loadMigrationPlan();
      const migrationIndex = plan.findIndex(
        ({ tag }) => tag === "0039_pay_sheet_initialization",
      );
      const migration = plan[migrationIndex];
      const dependentMigrations = plan.slice(migrationIndex + 1);
      assert.ok(migration);
      try {
        const finalFingerprint = await captureSchemaFingerprint(client);
        assert.equal(await actionExists(client), true);
        assert.equal(
          await functionExists(
            client,
            "initialize_pay_sheet_owner_chain(uuid,pay_sheet_owner_type,integer,integer,uuid,timestamp with time zone)",
          ),
          true,
        );
        assert.equal(
          await functionExists(
            client,
            "sync_mga_payment_sheet_placement_without_lazy_init(uuid,uuid,boolean,timestamp with time zone)",
          ),
          true,
        );
        assert.equal(
          await publicCanExecute(
            client,
            "initialize_pay_sheet_owner_chain(uuid,pay_sheet_owner_type,integer,integer,uuid,timestamp with time zone)",
          ),
          false,
        );

        for (const dependent of [...dependentMigrations].reverse()) {
          for (const statement of dependent.backoutStatements) {
            await client.query(statement);
          }
        }
        const migrationFingerprint = await captureSchemaFingerprint(client);

        for (const statement of migration.backoutStatements) {
          await client.query(statement);
        }
        assert.equal(await actionExists(client), false);
        assert.equal(
          await functionExists(
            client,
            "initialize_pay_sheet_owner_chain(uuid,pay_sheet_owner_type,integer,integer,uuid,timestamp with time zone)",
          ),
          false,
        );
        assert.equal(
          await functionExists(
            client,
            "sync_mga_payment_sheet_placement_without_lazy_init(uuid,uuid,boolean,timestamp with time zone)",
          ),
          false,
        );
        assert.equal(
          await functionExists(
            client,
            "sync_mga_payment_sheet_placement(uuid,uuid,boolean,timestamp with time zone)",
          ),
          true,
        );
        assert.notEqual(
          await captureSchemaFingerprint(client),
          migrationFingerprint,
        );

        for (const statement of migration.forwardStatements) {
          await client.query(statement);
        }
        assert.equal(
          await captureSchemaFingerprint(client),
          migrationFingerprint,
        );
        for (const dependent of dependentMigrations) {
          for (const statement of dependent.forwardStatements) {
            await client.query(statement);
          }
        }
        assert.equal(
          await captureSchemaFingerprint(client),
          finalFingerprint,
        );
      } finally {
        await client.end();
      }
    },
  );
});

async function initialize(
  pool: pg.Pool,
  ownerUserId: string,
  ownerType: "producer" | "sophia",
  periodMonth: number,
  periodYear: number,
  actorUserId: string,
  openedAt: Date,
): Promise<InitializationResult> {
  const result = await pool.query<{ initialization: InitializationResult }>(
    `SELECT initialize_pay_sheet_owner_chain(
       $1::uuid,
       $2::pay_sheet_owner_type,
       $3::integer,
       $4::integer,
       $5::uuid,
       $6::timestamptz
     ) AS initialization`,
    [ownerUserId, ownerType, periodMonth, periodYear, actorUserId, openedAt],
  );
  const initialization = result.rows[0]?.initialization;
  assert.ok(initialization);
  return initialization;
}

async function expectCode(
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  await assert.rejects(
    action,
    (error: unknown) => readDatabaseErrorCode(error) === code,
  );
}

async function count(
  pool: pg.Pool,
  table: "audit_events" | "pay_sheets",
  condition = "TRUE",
): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `SELECT count(*)::integer AS count FROM ${table} WHERE ${condition}`,
  );
  return result.rows[0]?.count ?? 0;
}

async function ownerSheetCount(
  pool: pg.Pool,
  ownerUserId: string,
  ownerType: "producer" | "sophia",
): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `SELECT count(*)::integer AS count
     FROM pay_sheets
     WHERE owner_user_id = $1 AND owner_type = $2`,
    [ownerUserId, ownerType],
  );
  return result.rows[0]?.count ?? 0;
}

async function ownerInitializationAuditCount(
  pool: pg.Pool,
  ownerUserId: string,
): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `SELECT count(*)::integer AS count
     FROM audit_events
     WHERE action = 'pay_sheet_initialized'::audit_action
       AND after_summary ->> 'ownerUserId' = $1`,
    [ownerUserId],
  );
  return result.rows[0]?.count ?? 0;
}

async function actionExists(client: pg.Client): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_enum
      JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
      WHERE pg_type.typname = 'audit_action'
        AND pg_enum.enumlabel = 'pay_sheet_initialized'
    ) AS exists
  `);
  return result.rows[0]?.exists ?? false;
}

async function functionExists(
  client: pg.Client,
  signature: string,
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    "SELECT to_regprocedure($1) IS NOT NULL AS exists",
    [signature],
  );
  return result.rows[0]?.exists ?? false;
}

async function publicCanExecute(
  client: pg.Client,
  signature: string,
): Promise<boolean> {
  const result = await client.query<{ allowed: boolean }>(
    `SELECT has_function_privilege('public', $1, 'EXECUTE') AS allowed`,
    [signature],
  );
  return result.rows[0]?.allowed ?? false;
}
