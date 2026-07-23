import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { withDisposableMigratedDatabase } from "./disposable-database-test-helper.js";
import { loadMigrationPlan } from "./migration-plan.js";
import { captureSchemaFingerprint } from "./migration-safety.js";

const previousFingerprint =
  "3af121916d459cb042c746c1b4e2cacd0eeb311be7b7b7f4d94170e7f16cedcf";
const currentFingerprint =
  "47c912b2cfdc868974d514f5ff04f8a9971d00053fc6a2b5c091dc258d3569dc";

test("staff assignment schema rolls back and reapplies transactionally", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for assignment migration test");
  const migration = loadMigrationPlan().find(
    ({ tag }) => tag === "0055_staff_assignment_options",
  );
  assert.ok(migration);

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_assign_opts",
    async (isolatedUrl) => {
      const client = new pg.Client({ connectionString: isolatedUrl });
      await client.connect();
      try {
        await client.query("BEGIN");
        assert.deepEqual(await readAssignmentSchema(client), {
          book: true,
          firstYear: true,
        });
        assert.deepEqual(await readGenerationContract(client), {
          fingerprint: currentFingerprint,
          migrationCount: 56,
        });
        assert.equal(await captureSchemaFingerprint(client), currentFingerprint);

        for (const statement of migration.backoutStatements) {
          await client.query(statement);
        }
        assert.deepEqual(await readAssignmentSchema(client), {
          book: false,
          firstYear: false,
        });
        assert.deepEqual(await readGenerationContract(client), {
          fingerprint: previousFingerprint,
          migrationCount: 55,
        });
        assert.equal(await captureSchemaFingerprint(client), previousFingerprint);

        for (const statement of migration.forwardStatements) {
          await client.query(statement);
        }
        assert.deepEqual(await readAssignmentSchema(client), {
          book: true,
          firstYear: true,
        });
        assert.equal(await captureSchemaFingerprint(client), currentFingerprint);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        await client.end();
      }
    },
  );
});

async function readAssignmentSchema(client: pg.Client): Promise<{
  book: boolean;
  firstYear: boolean;
}> {
  const result = await client.query<{ column_name: string }>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'staff_profiles'
      AND column_name = ANY($1::text[])
  `, [["book_assignment_enabled", "first_year_assignment_enabled"]]);
  const columns = new Set(result.rows.map(({ column_name }) => column_name));
  return {
    book: columns.has("book_assignment_enabled"),
    firstYear: columns.has("first_year_assignment_enabled"),
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
