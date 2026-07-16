import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { loadMigrationPlan } from "./migration-plan.js";
import { captureSchemaFingerprint } from "./migration-safety.js";
import { readDatabaseErrorCode } from "./error-code.js";

const validPasswordHash =
  "$2b$10$DA2BkeOLidNMTWnMvpyAj.I9tWFMwSTWG4LihsLTuEj.F/uK./VMq";
const actions = ["vocabulary_deactivated", "vocabulary_reactivated"] as const;
const priorFingerprint =
  "711b9e77d25ff30f93e97a00bacf3e2ec83921d4932f772e6fcf92fe381c0018";
const currentFingerprint =
  "57bc6941af31d880226836275bfa47ee66d849de269b0043bf00fd77c895aeb3";

test("vocabulary management audit actions preserve history and reverse cleanly", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for vocabulary audit test");
  const migration = loadMigrationPlan().find(
    ({ tag }) => tag === "0049_vocabulary_management_audit_actions",
  );
  assert.ok(migration);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query("BEGIN");
    const actorId = randomUUID();
    await client.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, $2, $3)`,
      [actorId, `vocabulary-audit-${actorId}@example.test`, validPasswordHash],
    );
    const expectedEnum = await readAuditActions(client);
    assert.deepEqual(expectedEnum.slice(-2), actions);
    assert.deepEqual(await readGenerationContract(client), {
      fingerprint: currentFingerprint,
      migrationCount: 50,
    });

    await client.query("SAVEPOINT vocabulary_audit_events");
    for (const [index, action] of actions.entries()) {
      const result = await client.query<{ event_id: string }>(
        `SELECT record_audit_event(
           $1::uuid, $2::audit_action, 'carrier'::audit_entity_type,
           $3::uuid, $4::jsonb, $5::jsonb
         ) AS event_id`,
        [actorId, action, randomUUID(), { isActive: index === 0 }, { isActive: index === 1 }],
      );
      assert.ok(result.rows[0]?.event_id);
    }
    await expectDatabaseError(client, "55000", () =>
      client.query(migration.backoutStatements[0]!),
    );

    await client.query("ROLLBACK TO SAVEPOINT vocabulary_audit_events");
    await client.query("RELEASE SAVEPOINT vocabulary_audit_events");
    const fingerprintBefore = await captureSchemaFingerprint(client);
    for (const statement of migration.backoutStatements) {
      await client.query(statement);
    }
    assert.deepEqual(await readAuditActions(client), expectedEnum.slice(0, -2));
    assert.deepEqual(await readGenerationContract(client), {
      fingerprint: priorFingerprint,
      migrationCount: 49,
    });
    await expectDatabaseError(client, "22P02", () =>
      client.query("SELECT 'vocabulary_deactivated'::audit_action"),
    );

    for (const statement of migration.forwardStatements) {
      await client.query(statement);
    }
    assert.deepEqual(await readAuditActions(client), expectedEnum);
    assert.equal(await captureSchemaFingerprint(client), fingerprintBefore);
    assert.deepEqual(await readGenerationContract(client), {
      fingerprint: currentFingerprint,
      migrationCount: 50,
    });
    assert.equal(await publicCanExecuteWriter(client), false);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
});

async function expectDatabaseError(
  client: pg.Client,
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  await client.query("SAVEPOINT expected_vocabulary_audit_error");
  try {
    await assert.rejects(
      action,
      (error: unknown) => readDatabaseErrorCode(error) === code,
    );
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT expected_vocabulary_audit_error");
    await client.query("RELEASE SAVEPOINT expected_vocabulary_audit_error");
  }
}

async function readAuditActions(client: pg.Client): Promise<string[]> {
  const result = await client.query<{ enumlabel: string }>(`
    SELECT value.enumlabel
    FROM pg_type AS type
    JOIN pg_enum AS value ON value.enumtypid = type.oid
    JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = 'public' AND type.typname = 'audit_action'
    ORDER BY value.enumsortorder
  `);
  return result.rows.map(({ enumlabel }) => enumlabel);
}

async function readGenerationContract(
  client: pg.Client,
): Promise<{ fingerprint: string; migrationCount: number }> {
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

async function publicCanExecuteWriter(client: pg.Client): Promise<boolean> {
  const result = await client.query<{ allowed: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc AS procedure
      CROSS JOIN LATERAL aclexplode(
        coalesce(procedure.proacl, acldefault('f', procedure.proowner))
      ) AS privilege
      WHERE procedure.oid =
        'record_audit_event(uuid,audit_action,audit_entity_type,uuid,jsonb,jsonb,timestamp with time zone)'::regprocedure
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) AS allowed
  `);
  return result.rows[0]?.allowed ?? true;
}
