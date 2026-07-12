import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { readDatabaseErrorCode } from "./error-code.js";
import { loadMigrationPlan } from "./migration-plan.js";
import { captureSchemaFingerprint } from "./migration-safety.js";

const validPasswordHash =
  "$2b$10$DA2BkeOLidNMTWnMvpyAj.I9tWFMwSTWG4LihsLTuEj.F/uK./VMq";
const actions = [
  "producer_commission_receipt_marked",
  "producer_commission_receipt_unmarked",
] as const;

async function expectDatabaseError(
  client: pg.Client,
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  await client.query("SAVEPOINT expected_receipt_audit_error");
  try {
    await assert.rejects(
      action,
      (error: unknown) => readDatabaseErrorCode(error) === code,
    );
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT expected_receipt_audit_error");
    await client.query("RELEASE SAVEPOINT expected_receipt_audit_error");
  }
}

test("receipt audit actions preserve bounded append-only behavior and reverse cleanly", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for receipt audit test");

  const migration = loadMigrationPlan().find(
    ({ tag }) => tag === "0038_producer_commission_receipt_audit_actions",
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
      [actorId, `receipt-audit-${actorId}@example.test`, validPasswordHash],
    );
    const expectedEnum = await readAuditActions(client);
    assert.deepEqual(expectedEnum.slice(-2), actions);
    assert.equal(await publicCanExecuteWriter(client), false);

    await client.query("SAVEPOINT receipt_audit_events");
    const eventIds: string[] = [];
    for (const [index, action] of actions.entries()) {
      const entityId = randomUUID();
      const created = await client.query<{ event_id: string }>(
        `SELECT record_audit_event(
           $1::uuid,
           $2::audit_action,
           'policy'::audit_entity_type,
           $3::uuid,
           $4::jsonb,
           $5::jsonb
         ) AS event_id`,
        [
          actorId,
          action,
          entityId,
          { receiptMarked: index === 1 },
          { receiptMarked: index === 0 },
        ],
      );
      const eventId = created.rows[0]?.event_id;
      assert.ok(eventId);
      eventIds.push(eventId);
    }

    const stored = await client.query<{
      action: string;
      entity_type: string;
    }>(
      `SELECT action::text, entity_type::text
       FROM audit_events
       WHERE id = ANY($1::uuid[])
       ORDER BY action::text`,
      [eventIds],
    );
    assert.deepEqual(stored.rows, [
      {
        action: "producer_commission_receipt_marked",
        entity_type: "policy",
      },
      {
        action: "producer_commission_receipt_unmarked",
        entity_type: "policy",
      },
    ]);

    await expectDatabaseError(client, "22P02", () =>
      client.query("SELECT 'unknown_receipt_action'::audit_action"),
    );
    await expectDatabaseError(client, "55000", () =>
      client.query("UPDATE audit_events SET after_summary = '{}' WHERE id = $1", [
        eventIds[0],
      ]),
    );
    await expectDatabaseError(client, "55000", () =>
      client.query("DELETE FROM audit_events WHERE id = $1", [eventIds[0]]),
    );
    await expectDatabaseError(client, "55000", () =>
      client.query(migration.backoutStatements[0]!),
    );

    await client.query("ROLLBACK TO SAVEPOINT receipt_audit_events");
    await client.query("RELEASE SAVEPOINT receipt_audit_events");
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    const fingerprintBefore = await captureSchemaFingerprint(client);

    for (const statement of migration.backoutStatements) {
      await client.query(statement);
    }
    const priorEnum = await readAuditActions(client);
    assert.deepEqual(priorEnum, expectedEnum.slice(0, -2));
    assert.equal(await publicCanExecuteWriter(client), false);
    await expectDatabaseError(client, "22P02", () =>
      client.query("SELECT 'producer_commission_receipt_marked'::audit_action"),
    );

    for (const statement of migration.forwardStatements) {
      await client.query(statement);
    }
    assert.deepEqual(await readAuditActions(client), expectedEnum);
    assert.equal(await captureSchemaFingerprint(client), fingerprintBefore);
    assert.equal(await publicCanExecuteWriter(client), false);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
});

async function readAuditActions(client: pg.Client): Promise<string[]> {
  const result = await client.query<{ enumlabel: string }>(`
    SELECT enum_value.enumlabel
    FROM pg_type AS enum_type
    JOIN pg_enum AS enum_value ON enum_value.enumtypid = enum_type.oid
    JOIN pg_namespace AS namespace ON namespace.oid = enum_type.typnamespace
    WHERE namespace.nspname = 'public'
      AND enum_type.typname = 'audit_action'
    ORDER BY enum_value.enumsortorder
  `);
  return result.rows.map(({ enumlabel }) => enumlabel);
}

async function publicCanExecuteWriter(client: pg.Client): Promise<boolean> {
  const result = await client.query<{ allowed: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc AS procedure
      CROSS JOIN LATERAL aclexplode(
        coalesce(
          procedure.proacl,
          acldefault('f', procedure.proowner)
        )
      ) AS privilege
      WHERE procedure.oid =
        'record_audit_event(uuid,audit_action,audit_entity_type,uuid,jsonb,jsonb,timestamp with time zone)'::regprocedure
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) AS allowed
  `);
  return result.rows[0]?.allowed ?? true;
}
