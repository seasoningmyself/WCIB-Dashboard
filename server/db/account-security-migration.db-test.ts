import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { withDisposableMigratedDatabase } from "./disposable-database-test-helper.js";
import { loadMigrationPlan } from "./migration-plan.js";
import { captureSchemaFingerprint } from "./migration-safety.js";

const previousFingerprint =
  "0185cf8f1e925f2255f565e7b4e71e99e9db7eae3551518241af40f56cbc7553";
const currentFingerprint =
  "2e9f37930b5a85aa44f6a77184ba013eda6eb246133e5c02dc2a4d1a91d5fd2b";

test("account security schema rolls back and reapplies transactionally", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for security migration test");
  const migration = loadMigrationPlan().find(
    ({ tag }) => tag === "0052_security_first_login_settings",
  );
  assert.ok(migration);

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_security_schema",
    async (isolatedUrl) => {
      const client = new pg.Client({ connectionString: isolatedUrl });
      await client.connect();
      try {
        await client.query("BEGIN");
        assert.deepEqual(await readSecuritySchema(client), currentSchemaState());
        assert.deepEqual(await readGenerationContract(client), {
          fingerprint: currentFingerprint,
          migrationCount: 53,
        });
        assert.equal(await captureSchemaFingerprint(client), currentFingerprint);

        for (const statement of migration.backoutStatements) {
          await client.query(statement);
        }
        assert.deepEqual(await readSecuritySchema(client), previousSchemaState());
        assert.deepEqual(await readGenerationContract(client), {
          fingerprint: previousFingerprint,
          migrationCount: 52,
        });
        assert.equal(await captureSchemaFingerprint(client), previousFingerprint);

        for (const statement of migration.forwardStatements) {
          await client.query(statement);
        }
        assert.deepEqual(await readSecuritySchema(client), currentSchemaState());
        assert.deepEqual(await readGenerationContract(client), {
          fingerprint: currentFingerprint,
          migrationCount: 53,
        });
        assert.equal(await captureSchemaFingerprint(client), currentFingerprint);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        await client.end();
      }
    },
  );
});

interface SecuritySchemaState {
  auditActions: string[];
  auditEntityTypes: string[];
  loginThrottleTable: boolean;
  recordAuditPublicExecute: boolean;
  staffDisplayName: boolean;
  staffOfficeLocation: boolean;
  userDisplayName: boolean;
  userPasswordChangeRequired: boolean;
  userPasswordConstraint: string;
}

function currentSchemaState(): SecuritySchemaState {
  return {
    auditActions: [
      "user_password_changed",
      "user_profile_changed",
      "user_temporary_password_issued",
    ],
    auditEntityTypes: ["user"],
    loginThrottleTable: true,
    recordAuditPublicExecute: false,
    staffDisplayName: false,
    staffOfficeLocation: true,
    userDisplayName: true,
    userPasswordChangeRequired: true,
    userPasswordConstraint:
      "CHECK ((password_hash ~ '^(\\$2[aby]\\$[0-9]{2}\\$[./A-Za-z0-9]{53}|\\$argon2id\\$v=19\\$m=[0-9]+,t=[0-9]+,p=[0-9]+\\$[A-Za-z0-9+/]+\\$[A-Za-z0-9+/]+)$'::text))",
  };
}

function previousSchemaState(): SecuritySchemaState {
  return {
    auditActions: [],
    auditEntityTypes: [],
    loginThrottleTable: false,
    recordAuditPublicExecute: false,
    staffDisplayName: true,
    staffOfficeLocation: false,
    userDisplayName: false,
    userPasswordChangeRequired: false,
    userPasswordConstraint:
      "CHECK ((password_hash ~ '^\\$2[aby]\\$[0-9]{2}\\$[./A-Za-z0-9]{53}$'::text))",
  };
}

async function readSecuritySchema(client: pg.Client): Promise<SecuritySchemaState> {
  const columns = await client.query<{
    column_name: string;
    table_name: string;
  }>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('users', 'staff_profiles')
  `);
  const columnNames = new Set(
    columns.rows.map(({ column_name, table_name }) => `${table_name}.${column_name}`),
  );
  const table = await client.query<{ exists: boolean }>(`
    SELECT to_regclass('public.login_throttle_buckets') IS NOT NULL AS exists
  `);
  const enumValues = await client.query<{ enumlabel: string; typname: string }>(`
    SELECT type.typname, value.enumlabel
    FROM pg_type AS type
    JOIN pg_enum AS value ON value.enumtypid = type.oid
    JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = 'public'
      AND type.typname IN ('audit_action', 'audit_entity_type')
      AND value.enumlabel IN (
        'user_password_changed',
        'user_profile_changed',
        'user_temporary_password_issued',
        'user'
      )
    ORDER BY value.enumsortorder
  `);
  const permission = await client.query<{ allowed: boolean }>(`
    SELECT has_function_privilege(
      'public',
      'record_audit_event(uuid,audit_action,audit_entity_type,uuid,jsonb,jsonb,timestamp with time zone)',
      'EXECUTE'
    ) AS allowed
  `);
  const passwordConstraint = await client.query<{ definition: string }>(`
    SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conname = 'users_password_hash_format_check'
  `);
  return {
    auditActions: enumValues.rows
      .filter(({ typname }) => typname === "audit_action")
      .map(({ enumlabel }) => enumlabel),
    auditEntityTypes: enumValues.rows
      .filter(({ typname }) => typname === "audit_entity_type")
      .map(({ enumlabel }) => enumlabel),
    loginThrottleTable: table.rows[0]?.exists ?? false,
    recordAuditPublicExecute: permission.rows[0]?.allowed ?? true,
    staffDisplayName: columnNames.has("staff_profiles.display_name"),
    staffOfficeLocation: columnNames.has("staff_profiles.office_location_id"),
    userDisplayName: columnNames.has("users.display_name"),
    userPasswordChangeRequired: columnNames.has(
      "users.password_change_required_at",
    ),
    userPasswordConstraint: passwordConstraint.rows[0]?.definition ?? "",
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
