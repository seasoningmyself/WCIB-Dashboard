import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import pg from "pg";
import { withDisposableDatabase } from "./disposable-database-test-helper.js";
import { readDatabaseErrorCode } from "./error-code.js";
import { applyMigrations, migrationAdvisoryLockKey } from "./migrate.js";
import {
  assertMigrationPlanIsTransactional,
  loadMigrationPlan,
  type MigrationPlanEntry,
} from "./migration-plan.js";

const allowedDisposableHosts = new Set(["127.0.0.1", "::1", "db", "localhost"]);

export const failureInjectionTags = [
  "0008_office_locations",
  "0013_draft_integrity",
  "0018_audit_integrity",
  "0019_policy_references",
] as const;

interface MigrationHistoryRow {
  created_at: string;
  hash: string;
}

export interface MigrationSafetyResult {
  failureInjectionTags: readonly string[];
  finalFingerprint: string;
  migrationCount: number;
  phases: MigrationSafetyPhase[];
}

export interface MigrationSafetyPhase {
  durationMs: number;
  name: string;
  status: "passed";
}

function assertDisposableSourceUrl(sourceDatabaseUrl: string): void {
  const url = new URL(sourceDatabaseUrl);
  if (!allowedDisposableHosts.has(url.hostname)) {
    throw new Error(
      "Migration safety verification only accepts the local Docker PostgreSQL source",
    );
  }
}

async function withClient<T>(
  databaseUrl: string,
  action: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await action(client);
  } finally {
    await client.end();
  }
}

async function recordPhase<T>(
  phases: MigrationSafetyPhase[],
  name: string,
  action: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  const result = await action();
  phases.push({
    durationMs: Math.round(performance.now() - startedAt),
    name,
    status: "passed",
  });
  return result;
}

export function formatMigrationSafetyError(error: unknown): string {
  const code = readDatabaseErrorCode(error);
  return code === undefined
    ? "Migration safety verification failed"
    : `Migration safety verification failed (${code})`;
}

async function executeStatements(
  client: pg.Client,
  statements: readonly string[],
): Promise<void> {
  for (const statement of statements) {
    await client.query(statement);
  }
}

async function ensureMigrationHistory(client: pg.Client): Promise<void> {
  await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle"');
  await client.query(`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      "id" serial PRIMARY KEY,
      "hash" text NOT NULL,
      "created_at" bigint
    )
  `);
}

async function readMigrationHistory(
  client: pg.Client,
): Promise<MigrationHistoryRow[]> {
  const schema = await client.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'drizzle'
        AND table_name = '__drizzle_migrations'
    ) AS "exists"
  `);
  if (schema.rows[0]?.exists !== true) {
    return [];
  }

  const history = await client.query<MigrationHistoryRow>(`
    SELECT "hash", "created_at"::text
    FROM "drizzle"."__drizzle_migrations"
    ORDER BY "created_at"
  `);
  return history.rows;
}

function expectedHistory(
  entries: readonly MigrationPlanEntry[],
): MigrationHistoryRow[] {
  return entries.map((entry) => ({
    created_at: String(entry.when),
    hash: entry.forwardHash,
  }));
}

async function assertHistoryMatches(
  client: pg.Client,
  entries: readonly MigrationPlanEntry[],
): Promise<void> {
  assert.deepEqual(await readMigrationHistory(client), expectedHistory(entries));
}

export async function captureSchemaFingerprint(
  client: pg.Client,
): Promise<string> {
  const result = await client.query<{ definition: string; identity: string; kind: string }>(`
    WITH schema_objects AS (
      SELECT
        'column'::text AS kind,
        format('%I.%I.%I', table_schema, table_name, column_name) AS identity,
        concat_ws('|', column_name, data_type, udt_schema, udt_name,
          is_nullable, coalesce(column_default, ''), coalesce(is_identity, ''),
          coalesce(identity_generation, ''), coalesce(is_generated, '')) AS definition
      FROM information_schema.columns
      WHERE table_schema = 'public'

      UNION ALL
      SELECT 'constraint', conrelid::regclass::text || '.' || conname,
        contype::text || '|' || pg_get_constraintdef(oid, true)
      FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace

      UNION ALL
      SELECT 'index', schemaname || '.' || indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'

      UNION ALL
      SELECT 'trigger', event_object_schema || '.' || event_object_table || '.' || trigger_name,
        action_timing || '|' || event_manipulation || '|' || action_statement
      FROM information_schema.triggers
      WHERE trigger_schema = 'public'

      UNION ALL
      SELECT 'function', n.nspname || '.' || p.proname || '(' ||
        pg_get_function_identity_arguments(p.oid) || ')', pg_get_functiondef(p.oid)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'

      UNION ALL
      SELECT 'enum', n.nspname || '.' || t.typname || '.' || e.enumsortorder::text,
        e.enumlabel
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE n.nspname = 'public'
    )
    SELECT kind, identity, definition
    FROM schema_objects
    ORDER BY kind, identity, definition
  `);

  return createHash("sha256").update(JSON.stringify(result.rows)).digest("hex");
}

async function applyEntries(
  client: pg.Client,
  entries: readonly MigrationPlanEntry[],
): Promise<void> {
  await ensureMigrationHistory(client);
  for (const entry of entries) {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock($1)", [
        migrationAdvisoryLockKey,
      ]);
      await executeStatements(client, entry.forwardStatements);
      await client.query(
        `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
         VALUES ($1, $2)`,
        [entry.forwardHash, entry.when],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
}

async function rollbackEntries(
  client: pg.Client,
  entries: readonly MigrationPlanEntry[],
): Promise<void> {
  for (const entry of [...entries].reverse()) {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock($1)", [
        migrationAdvisoryLockKey,
      ]);
      await executeStatements(client, entry.backoutStatements);
      await client.query(
        `DELETE FROM "drizzle"."__drizzle_migrations"
         WHERE "created_at" = $1 AND "hash" = $2`,
        [entry.when, entry.forwardHash],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  await client.query('DROP SCHEMA IF EXISTS "drizzle" CASCADE');
}

async function verifyInjectedFailure(
  client: pg.Client,
  plan: readonly MigrationPlanEntry[],
  tag: string,
): Promise<void> {
  const targetIndex = plan.findIndex((entry) => entry.tag === tag);
  assert.notEqual(targetIndex, -1, `missing failure-injection migration ${tag}`);
  const prefix = plan.slice(0, targetIndex);
  const target = plan[targetIndex];
  assert.ok(target);

  await applyEntries(client, prefix);
  const beforeFingerprint = await captureSchemaFingerprint(client);
  const beforeHistory = await readMigrationHistory(client);

  await client.query("BEGIN");
  try {
    await executeStatements(client, target.forwardStatements);
    await client.query(
      `INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
       VALUES ($1, $2)`,
      [target.forwardHash, target.when],
    );
    await assert.rejects(client.query("SELECT wcib_injected_migration_failure()"));
  } finally {
    await client.query("ROLLBACK");
  }

  assert.equal(await captureSchemaFingerprint(client), beforeFingerprint);
  assert.deepEqual(await readMigrationHistory(client), beforeHistory);
  await rollbackEntries(client, prefix);
}

export async function verifyMigrationSafety(
  sourceDatabaseUrl: string,
): Promise<MigrationSafetyResult> {
  assertDisposableSourceUrl(sourceDatabaseUrl);
  const plan = loadMigrationPlan();
  assertMigrationPlanIsTransactional(plan);

  let finalFingerprint = "";
  const phases: MigrationSafetyPhase[] = [];
  await withDisposableDatabase(
    sourceDatabaseUrl,
    "wcib_migration",
    async (databaseUrl) => {
      const baselineFingerprint = await withClient(
        databaseUrl,
        captureSchemaFingerprint,
      );

      finalFingerprint = await recordPhase(phases, "forward", async () => {
        await applyMigrations(databaseUrl);
        return withClient(databaseUrl, async (client) => {
          await assertHistoryMatches(client, plan);
          return captureSchemaFingerprint(client);
        });
      });

      await recordPhase(phases, "rollback", () =>
        withClient(databaseUrl, async (client) => {
          await rollbackEntries(client, plan);
          assert.equal(
            await captureSchemaFingerprint(client),
            baselineFingerprint,
          );
          assert.deepEqual(await readMigrationHistory(client), []);
        }),
      );

      await recordPhase(phases, "reapply", async () => {
        await applyMigrations(databaseUrl);
        await withClient(databaseUrl, async (client) => {
          await assertHistoryMatches(client, plan);
          assert.equal(
            await captureSchemaFingerprint(client),
            finalFingerprint,
          );
        });
      });

      await withClient(databaseUrl, async (client) => {
        await rollbackEntries(client, plan);
        for (const tag of failureInjectionTags) {
          await recordPhase(phases, `failure-injection:${tag}`, () =>
            verifyInjectedFailure(client, plan, tag),
          );
        }
      });
    },
  );

  return {
    failureInjectionTags,
    finalFingerprint,
    migrationCount: plan.length,
    phases,
  };
}
