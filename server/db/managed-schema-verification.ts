import assert from "node:assert/strict";
import pg from "pg";
import {
  approvedCoreSchemaFingerprint,
  coreSchemaTables,
  forbiddenCoreSchemaColumns,
  forbiddenCoreSchemaTables,
} from "./core-schema-contract.js";
import { readDatabaseErrorCode } from "./error-code.js";
import { captureSchemaFingerprint } from "./migration-safety.js";
import { loadMigrationPlan } from "./migration-plan.js";

interface CatalogCounts {
  checks: number;
  foreignKeys: number;
  functions: number;
  indexes: number;
  triggers: number;
}

interface MigrationHistoryRow {
  created_at: string;
  hash: string;
}

const expectedBlankTableRows: Readonly<Record<string, number>> = {
  business_state_control: 1,
  business_state_generations: 1,
};

export interface ManagedSchemaVerificationResult {
  catalog: CatalogCounts;
  checkedAt: string;
  database: string;
  fingerprint: string;
  migrationCount: number;
  role: string;
  serverVersion: string;
  tableCount: number;
  totalRows: number;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function formatManagedSchemaVerificationError(error: unknown): string {
  const code = readDatabaseErrorCode(error);
  return code === undefined
    ? "Managed schema verification failed"
    : `Managed schema verification failed (${code})`;
}

export async function verifyManagedSchema(
  databaseUrl: string,
): Promise<ManagedSchemaVerificationResult> {
  const plan = loadMigrationPlan();
  const client = new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();

  try {
    await client.query("BEGIN READ ONLY");

    const identity = await client.query<{
      checked_at: string;
      database: string;
      role: string;
      server_version: string;
    }>(`
      SELECT current_user AS role,
        current_database() AS database,
        current_setting('server_version') AS server_version,
        to_char(clock_timestamp() AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS checked_at
    `);
    assert.match(identity.rows[0]?.server_version ?? "", /^18\./);

    const history = await client.query<MigrationHistoryRow>(`
      SELECT "hash", "created_at"::text
      FROM "drizzle"."__drizzle_migrations"
      ORDER BY "created_at"
    `);
    assert.deepEqual(
      history.rows,
      plan.map((entry) => ({
        created_at: String(entry.when),
        hash: entry.forwardHash,
      })),
    );

    const tables = await client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    assert.deepEqual(
      tables.rows.map((row) => row.table_name),
      [...coreSchemaTables],
    );

    const forbidden = await client.query<{
      forbidden_columns: number;
      forbidden_tables: number;
    }>(`
      SELECT
        (
          SELECT count(*)::int
          FROM information_schema.tables
          WHERE table_schema = 'public'
            AND (
              table_name LIKE '%budget%'
              OR table_name = ANY($1::text[])
            )
        ) AS forbidden_tables,
        (
          SELECT count(*)::int
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND column_name = ANY($2::text[])
        ) AS forbidden_columns
    `, [[...forbiddenCoreSchemaTables], [...forbiddenCoreSchemaColumns]]);
    assert.deepEqual(forbidden.rows[0], {
      forbidden_columns: 0,
      forbidden_tables: 0,
    });

    let totalRows = 0;
    for (const table of coreSchemaTables) {
      const count = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM ${quoteIdentifier(table)}`,
      );
      const tableRows = count.rows[0]?.count ?? 0;
      assert.equal(tableRows, expectedBlankTableRows[table] ?? 0);
      totalRows += tableRows;
    }
    assert.equal(totalRows, 2);

    const catalog = await client.query<{
      checks: number;
      foreign_keys: number;
      functions: number;
      indexes: number;
      triggers: number;
    }>(`
      SELECT
        (SELECT count(*)::int FROM pg_constraint
          WHERE connamespace = 'public'::regnamespace AND contype = 'c') AS checks,
        (SELECT count(*)::int FROM pg_constraint
          WHERE connamespace = 'public'::regnamespace AND contype = 'f') AS foreign_keys,
        (SELECT count(*)::int FROM pg_proc
          WHERE pronamespace = 'public'::regnamespace) AS functions,
        (SELECT count(*)::int FROM pg_indexes
          WHERE schemaname = 'public') AS indexes,
        (SELECT count(*)::int FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND NOT t.tgisinternal) AS triggers
    `);
    const counts = catalog.rows[0];
    assert.ok(counts);
    assert.ok(counts.checks > 0);
    assert.ok(counts.foreign_keys > 0);
    assert.ok(counts.functions > 0);
    assert.ok(counts.indexes > 0);
    assert.ok(counts.triggers > 0);

    const fingerprint = await captureSchemaFingerprint(client);
    assert.equal(fingerprint, approvedCoreSchemaFingerprint);
    await client.query("COMMIT");

    const current = identity.rows[0];
    assert.ok(current);
    return {
      catalog: {
        checks: counts.checks,
        foreignKeys: counts.foreign_keys,
        functions: counts.functions,
        indexes: counts.indexes,
        triggers: counts.triggers,
      },
      checkedAt: current.checked_at,
      database: current.database,
      fingerprint,
      migrationCount: history.rows.length,
      role: current.role,
      serverVersion: current.server_version,
      tableCount: tables.rows.length,
      totalRows,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
