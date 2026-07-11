import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import pg from "pg";
import { readDatabaseErrorCode } from "./error-code.js";

const validPasswordHash =
  "$2b$10$DA2BkeOLidNMTWnMvpyAj.I9tWFMwSTWG4LihsLTuEj.F/uK./VMq";
const backoutSql = readFileSync(
  resolve(
    process.cwd(),
    "drizzle/backout/0035_vocabulary_creation_audit_vocabulary.sql",
  ),
  "utf8",
);

async function expectDatabaseError(
  client: pg.PoolClient,
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

test("vocabulary creation events use the bounded append-only audit path", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for audit database test");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const actorId = randomUUID();
    await client.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, $2, $3)`,
      [actorId, `vocabulary-audit-${actorId}@example.test`, validPasswordHash],
    );

    const cases = [
      {
        action: "carrier_created",
        after: { name: "Test Carrier" },
        entityType: "carrier",
      },
      {
        action: "policy_type_created",
        after: { classTag: "Commercial", name: "Test Policy Type" },
        entityType: "policy_type",
      },
      {
        action: "mga_created",
        after: { name: "Test MGA" },
        entityType: "mga",
      },
    ] as const;
    const eventIds: string[] = [];

    for (const entry of cases) {
      const entityId = randomUUID();
      const created = await client.query<{ event_id: string }>(
        `SELECT record_audit_event(
           $1::uuid,
           $2::audit_action,
           $3::audit_entity_type,
           $4::uuid,
           NULL,
           $5::jsonb
         ) AS event_id`,
        [actorId, entry.action, entry.entityType, entityId, entry.after],
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
       ORDER BY occurred_at, action::text`,
      [eventIds],
    );
    assert.deepEqual(
      stored.rows.map((row) => `${row.action}/${row.entity_type}`).sort(),
      [
        "carrier_created/carrier",
        "mga_created/mga",
        "policy_type_created/policy_type",
      ],
    );

    await expectDatabaseError(client, "22P02", () =>
      client.query("SELECT 'unknown_vocabulary_action'::audit_action"),
    );
    await expectDatabaseError(client, "22P02", () =>
      client.query("SELECT 'unknown_vocabulary_entity'::audit_entity_type"),
    );
    await expectDatabaseError(client, "23514", () =>
      client.query(
        `SELECT record_audit_event(
           $1::uuid,
           'carrier_created'::audit_action,
           'carrier'::audit_entity_type,
           $2::uuid,
           NULL,
           $3::jsonb
         )`,
        [actorId, randomUUID(), { nested: { forbidden: true } }],
      ),
    );
    await expectDatabaseError(client, "55000", () =>
      client.query(
        "UPDATE audit_events SET after_summary = '{}'::jsonb WHERE id = $1",
        [eventIds[0]],
      ),
    );
    await expectDatabaseError(client, "55000", () =>
      client.query("DELETE FROM audit_events WHERE id = $1", [eventIds[0]]),
    );
    await expectDatabaseError(client, "55000", () => client.query(backoutSql));

    const publicPrivilege = await client.query<{ revoked: boolean }>(`
      SELECT NOT EXISTS (
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
      ) AS revoked
    `);
    assert.equal(publicPrivilege.rows[0]?.revoked, true);

    const preserved = await client.query<{ event_count: string }>(
      `SELECT count(*)::text AS event_count
       FROM audit_events
       WHERE id = ANY($1::uuid[])`,
      [eventIds],
    );
    assert.equal(preserved.rows[0]?.event_count, "3");
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
