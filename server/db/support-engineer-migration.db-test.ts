import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { withDisposableMigratedDatabase } from "./disposable-database-test-helper.js";
import { loadMigrationPlan } from "./migration-plan.js";
import { captureSchemaFingerprint } from "./migration-safety.js";

const previousFingerprint =
  "a8a02c5d60d29136b7a0a28202ae97e05dfdf423d3c8e40440d18e3c60617ebf";
const currentFingerprint =
  "3af121916d459cb042c746c1b4e2cacd0eeb311be7b7b7f4d94170e7f16cedcf";
const supportActions = [
  "user_support_capability_changed",
  "support_surface_viewed",
  "office_location_created",
  "office_location_renamed",
  "office_location_deactivated",
  "office_location_reactivated",
];

test("support schema rolls back and reapplies transactionally", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for support migration test");
  const plan = loadMigrationPlan();
  const migrationIndex = plan.findIndex(
    ({ tag }) => tag === "0054_support_engineer_capability",
  );
  const migration = plan[migrationIndex];
  const dependentMigrations = plan.slice(migrationIndex + 1);
  assert.ok(migration);

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_support_schema",
    async (isolatedUrl) => {
      const client = new pg.Client({ connectionString: isolatedUrl });
      await client.connect();
      try {
        await client.query("BEGIN");
        for (const dependent of [...dependentMigrations].reverse()) {
          for (const statement of dependent.backoutStatements) {
            await client.query(statement);
          }
        }
        assert.deepEqual(await readSupportSchema(client), {
          actions: supportActions,
          lastLoginColumn: true,
          officeEntity: true,
        });
        assert.deepEqual(await readGenerationContract(client), {
          fingerprint: currentFingerprint,
          migrationCount: 55,
        });
        assert.equal(await captureSchemaFingerprint(client), currentFingerprint);

        for (const statement of migration.backoutStatements) {
          await client.query(statement);
        }
        assert.deepEqual(await readSupportSchema(client), {
          actions: [],
          lastLoginColumn: false,
          officeEntity: false,
        });
        assert.deepEqual(await readGenerationContract(client), {
          fingerprint: previousFingerprint,
          migrationCount: 54,
        });
        assert.equal(await captureSchemaFingerprint(client), previousFingerprint);

        for (const statement of migration.forwardStatements) {
          await client.query(statement);
        }
        assert.deepEqual(await readSupportSchema(client), {
          actions: supportActions,
          lastLoginColumn: true,
          officeEntity: true,
        });
        assert.equal(await captureSchemaFingerprint(client), currentFingerprint);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        await client.end();
      }
    },
  );
});

async function readSupportSchema(client: pg.Client): Promise<{
  actions: string[];
  lastLoginColumn: boolean;
  officeEntity: boolean;
}> {
  const actions = await client.query<{ enumlabel: string }>(`
    SELECT value.enumlabel
    FROM pg_type AS type
    JOIN pg_enum AS value ON value.enumtypid = type.oid
    WHERE type.typname = 'audit_action'
      AND value.enumlabel = ANY($1::text[])
    ORDER BY value.enumsortorder
  `, [supportActions]);
  const entity = await client.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_type AS type
      JOIN pg_enum AS value ON value.enumtypid = type.oid
      WHERE type.typname = 'audit_entity_type'
        AND value.enumlabel = 'office_location'
    ) AS exists
  `);
  const column = await client.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'last_login_at'
    ) AS exists
  `);
  return {
    actions: actions.rows.map(({ enumlabel }) => enumlabel),
    lastLoginColumn: column.rows[0]?.exists === true,
    officeEntity: entity.rows[0]?.exists === true,
  };
}

async function readGenerationContract(client: pg.Client): Promise<{
  fingerprint: string;
  migrationCount: number;
}> {
  const result = await client.query<{
    expected_migration_count: number;
    expected_schema_fingerprint: string;
  }>(`
    SELECT expected_migration_count, expected_schema_fingerprint
    FROM business_state_control
    WHERE singleton_id = 1
  `);
  const row = result.rows[0];
  assert.ok(row);
  return {
    fingerprint: row.expected_schema_fingerprint,
    migrationCount: row.expected_migration_count,
  };
}
