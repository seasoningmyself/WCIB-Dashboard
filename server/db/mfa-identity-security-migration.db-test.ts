import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { withDisposableMigratedDatabase } from "./disposable-database-test-helper.js";
import { loadMigrationPlan } from "./migration-plan.js";
import { captureSchemaFingerprint } from "./migration-safety.js";

const previousFingerprint =
  "2e9f37930b5a85aa44f6a77184ba013eda6eb246133e5c02dc2a4d1a91d5fd2b";
const currentFingerprint =
  "a8a02c5d60d29136b7a0a28202ae97e05dfdf423d3c8e40440d18e3c60617ebf";

test("MFA identity security rolls back and reapplies transactionally", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for MFA migration test");
  const migration = loadMigrationPlan().find(
    ({ tag }) => tag === "0053_mfa_identity_security",
  );
  const nextMigration = loadMigrationPlan().find(
    ({ tag }) => tag === "0054_support_engineer_capability",
  );
  assert.ok(migration);
  assert.ok(nextMigration);

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_mfa_schema",
    async (isolatedUrl) => {
      const client = new pg.Client({ connectionString: isolatedUrl });
      await client.connect();
      try {
        await client.query("BEGIN");
        for (const statement of nextMigration.backoutStatements) {
          await client.query(statement);
        }
        assert.deepEqual(await readMfaSchema(client), currentSchemaState());
        assert.deepEqual(await readGenerationContract(client), {
          fingerprint: currentFingerprint,
          migrationCount: 54,
        });
        assert.equal(await captureSchemaFingerprint(client), currentFingerprint);

        for (const statement of migration.backoutStatements) {
          await client.query(statement);
        }
        assert.deepEqual(await readMfaSchema(client), previousSchemaState());
        assert.deepEqual(await readGenerationContract(client), {
          fingerprint: previousFingerprint,
          migrationCount: 53,
        });
        assert.equal(await captureSchemaFingerprint(client), previousFingerprint);

        for (const statement of migration.forwardStatements) {
          await client.query(statement);
        }
        assert.deepEqual(await readMfaSchema(client), currentSchemaState());
        assert.deepEqual(await readGenerationContract(client), {
          fingerprint: currentFingerprint,
          migrationCount: 54,
        });
        assert.equal(await captureSchemaFingerprint(client), currentFingerprint);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        await client.end();
      }
    },
  );
});

interface MfaSchemaState {
  auditActions: string[];
  methodTable: boolean;
  newSettingsColumns: string[];
  placeholderTable: boolean;
  tables: string[];
}

const mfaTables = [
  "mfa_challenges",
  "mfa_recovery_grants",
  "mfa_step_up_authorizations",
  "user_mfa_recovery_codes",
  "user_totp_credentials",
  "user_webauthn_credential_transports",
  "user_webauthn_credentials",
];

const mfaAuditActions = [
  "user_mfa_enrolled",
  "user_mfa_method_added",
  "user_mfa_method_renamed",
  "user_mfa_method_removed",
  "user_mfa_recovery_code_used",
  "user_mfa_recovery_codes_regenerated",
  "user_mfa_challenge_succeeded",
  "user_mfa_challenge_failed",
  "user_mfa_step_up_succeeded",
  "user_mfa_step_up_failed",
  "user_mfa_disabled",
  "user_mfa_reset",
  "user_admin_capability_changed",
];

function currentSchemaState(): MfaSchemaState {
  return {
    auditActions: mfaAuditActions,
    methodTable: true,
    newSettingsColumns: [
      "enrollment_completed_at",
      "policy_required_at",
      "recovery_codes_acknowledged_at",
      "updated_at",
    ],
    placeholderTable: false,
    tables: mfaTables,
  };
}

function previousSchemaState(): MfaSchemaState {
  return {
    auditActions: [],
    methodTable: false,
    newSettingsColumns: [],
    placeholderTable: true,
    tables: [],
  };
}

async function readMfaSchema(client: pg.Client): Promise<MfaSchemaState> {
  const tables = await client.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY($1::text[])
    ORDER BY table_name
  `, [[
    ...mfaTables,
    "user_mfa_methods",
    "user_mfa_method_placeholders",
  ]]);
  const tableNames = tables.rows.map(({ table_name }) => table_name);
  const columns = await client.query<{ column_name: string }>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_mfa_settings'
      AND column_name = ANY($1::text[])
    ORDER BY column_name
  `, [[
    "policy_required_at",
    "enrollment_completed_at",
    "recovery_codes_acknowledged_at",
    "updated_at",
  ]]);
  const actions = await client.query<{ enumlabel: string }>(`
    SELECT value.enumlabel
    FROM pg_type AS type
    JOIN pg_enum AS value ON value.enumtypid = type.oid
    WHERE type.typname = 'audit_action'
      AND value.enumlabel = ANY($1::text[])
    ORDER BY value.enumsortorder
  `, [mfaAuditActions]);
  return {
    auditActions: actions.rows.map(({ enumlabel }) => enumlabel),
    methodTable: tableNames.includes("user_mfa_methods"),
    newSettingsColumns: columns.rows.map(({ column_name }) => column_name),
    placeholderTable: tableNames.includes("user_mfa_method_placeholders"),
    tables: tableNames.filter((name) => mfaTables.includes(name)),
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
