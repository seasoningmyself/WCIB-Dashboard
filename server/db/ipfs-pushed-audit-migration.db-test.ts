import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { readDatabaseErrorCode } from "./error-code.js";
import { loadMigrationPlan } from "./migration-plan.js";
import { captureSchemaFingerprint } from "./migration-safety.js";

const validPasswordHash =
  "$2b$10$DA2BkeOLidNMTWnMvpyAj.I9tWFMwSTWG4LihsLTuEj.F/uK./VMq";
const actions = ["policy_ipfs_pushed", "policy_ipfs_unpushed"] as const;
const priorSchemaFingerprint =
  "6a06ce086a9beb6b68f788f18afc03712019d56f56003401a9c796fec751991a";
const currentSchemaFingerprint =
  "711b9e77d25ff30f93e97a00bacf3e2ec83921d4932f772e6fcf92fe381c0018";

test("IPFS pushed audit actions preserve append-only history and reverse cleanly", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for IPFS audit test");
  const migration = loadMigrationPlan().find(
    ({ tag }) => tag === "0048_ipfs_pushed_audit_actions",
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
      [actorId, `ipfs-audit-${actorId}@example.test`, validPasswordHash],
    );
    const expectedEnum = await readAuditActions(client);
    assert.deepEqual(expectedEnum.slice(-2), actions);
    assert.equal(await publicCanExecuteWriter(client), false);
    assert.deepEqual(await readGenerationContract(client), {
      controlFingerprint: currentSchemaFingerprint,
      controlMigrationCount: 49,
      generationContracts: [{
        fingerprint: currentSchemaFingerprint,
        migrationCount: 49,
      }],
    });

    await client.query("SAVEPOINT ipfs_audit_events");
    const eventIds: string[] = [];
    for (const [index, action] of actions.entries()) {
      const result = await client.query<{ event_id: string }>(
        `SELECT record_audit_event(
           $1::uuid, $2::audit_action, 'policy'::audit_entity_type,
           $3::uuid, $4::jsonb, $5::jsonb
         ) AS event_id`,
        [
          actorId,
          action,
          randomUUID(),
          { pushed: index === 1 },
          { pushed: index === 0 },
        ],
      );
      assert.ok(result.rows[0]?.event_id);
      eventIds.push(result.rows[0]!.event_id);
    }
    const stored = await client.query<{ action: string }>(
      `SELECT action::text FROM audit_events
       WHERE id = ANY($1::uuid[]) ORDER BY action::text`,
      [eventIds],
    );
    assert.deepEqual(stored.rows, [
      { action: "policy_ipfs_pushed" },
      { action: "policy_ipfs_unpushed" },
    ]);
    await expectDatabaseError(client, "55000", () =>
      client.query(migration.backoutStatements[0]!),
    );

    await client.query("ROLLBACK TO SAVEPOINT ipfs_audit_events");
    await client.query("RELEASE SAVEPOINT ipfs_audit_events");
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    const fingerprintBefore = await captureSchemaFingerprint(client);

    for (const statement of migration.backoutStatements) {
      await client.query(statement);
    }
    assert.deepEqual(await readAuditActions(client), expectedEnum.slice(0, -2));
    assert.equal(await publicCanExecuteWriter(client), false);
    assert.deepEqual(await readGenerationContract(client), {
      controlFingerprint: priorSchemaFingerprint,
      controlMigrationCount: 48,
      generationContracts: [{
        fingerprint: priorSchemaFingerprint,
        migrationCount: 48,
      }],
    });
    await expectDatabaseError(client, "22P02", () =>
      client.query("SELECT 'policy_ipfs_pushed'::audit_action"),
    );

    for (const statement of migration.forwardStatements) {
      await client.query(statement);
    }
    assert.deepEqual(await readAuditActions(client), expectedEnum);
    assert.equal(await captureSchemaFingerprint(client), fingerprintBefore);
    assert.equal(await publicCanExecuteWriter(client), false);
    assert.deepEqual(await readGenerationContract(client), {
      controlFingerprint: currentSchemaFingerprint,
      controlMigrationCount: 49,
      generationContracts: [{
        fingerprint: currentSchemaFingerprint,
        migrationCount: 49,
      }],
    });
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
  await client.query("SAVEPOINT expected_ipfs_audit_error");
  try {
    await assert.rejects(
      action,
      (error: unknown) => readDatabaseErrorCode(error) === code,
    );
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT expected_ipfs_audit_error");
    await client.query("RELEASE SAVEPOINT expected_ipfs_audit_error");
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

async function readGenerationContract(client: pg.Client): Promise<{
  controlFingerprint: string;
  controlMigrationCount: number;
  generationContracts: Array<{ fingerprint: string; migrationCount: number }>;
}> {
  const control = await client.query<{
    expected_migration_count: number;
    expected_schema_fingerprint: string;
  }>(`
    SELECT expected_migration_count, expected_schema_fingerprint
    FROM business_state_control
    WHERE singleton_id = 1
  `);
  const generations = await client.query<{
    migration_count: number;
    schema_fingerprint: string;
  }>(`
    SELECT DISTINCT migration_count, schema_fingerprint
    FROM business_state_generations
    ORDER BY migration_count, schema_fingerprint
  `);
  const current = control.rows[0];
  assert.ok(current);
  return {
    controlFingerprint: current.expected_schema_fingerprint,
    controlMigrationCount: current.expected_migration_count,
    generationContracts: generations.rows.map((row) => ({
      fingerprint: row.schema_fingerprint,
      migrationCount: row.migration_count,
    })),
  };
}
