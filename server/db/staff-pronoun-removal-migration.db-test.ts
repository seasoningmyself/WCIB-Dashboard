import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { loadMigrationPlan } from "./migration-plan.js";
import { captureSchemaFingerprint } from "./migration-safety.js";

const previousFingerprint =
  "38587c7e033c1435be24e7914b0a167d29ee56c2176a20c79b3cd140671e64c1";
const currentFingerprint =
  "0185cf8f1e925f2255f565e7b4e71e99e9db7eae3551518241af40f56cbc7553";

test("pronoun schema removal rolls back and reapplies transactionally", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for pronoun migration test");
  const migration = loadMigrationPlan().find(
    ({ tag }) => tag === "0051_remove_staff_pronoun",
  );
  assert.ok(migration);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("BEGIN");
    assert.deepEqual(await readPronounSchema(client), {
      column: false,
      enumValues: [],
    });
    assert.deepEqual(await readGenerationContract(client), {
      fingerprint: currentFingerprint,
      migrationCount: 52,
    });
    const fingerprintBefore = await captureSchemaFingerprint(client);
    assert.equal(fingerprintBefore, currentFingerprint);

    for (const statement of migration.backoutStatements) {
      await client.query(statement);
    }
    assert.deepEqual(await readPronounSchema(client), {
      column: true,
      enumValues: ["her", "his", "their"],
    });
    assert.deepEqual(await readGenerationContract(client), {
      fingerprint: previousFingerprint,
      migrationCount: 51,
    });
    assert.equal(await captureSchemaFingerprint(client), previousFingerprint);

    for (const statement of migration.forwardStatements) {
      await client.query(statement);
    }
    assert.deepEqual(await readPronounSchema(client), {
      column: false,
      enumValues: [],
    });
    assert.deepEqual(await readGenerationContract(client), {
      fingerprint: currentFingerprint,
      migrationCount: 52,
    });
    assert.equal(await captureSchemaFingerprint(client), fingerprintBefore);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
});

async function readPronounSchema(client: pg.Client): Promise<{
  column: boolean;
  enumValues: string[];
}> {
  const column = await client.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'staff_profiles'
        AND column_name = 'pronoun'
    ) AS exists
  `);
  const values = await client.query<{ enumlabel: string }>(`
    SELECT value.enumlabel
    FROM pg_type AS type
    JOIN pg_enum AS value ON value.enumtypid = type.oid
    JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = 'public'
      AND type.typname = 'staff_pronoun'
    ORDER BY value.enumsortorder
  `);
  return {
    column: column.rows[0]?.exists ?? false,
    enumValues: values.rows.map(({ enumlabel }) => enumlabel),
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
