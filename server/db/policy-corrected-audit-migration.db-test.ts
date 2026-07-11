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
    "drizzle/backout/0033_policy_corrected_audit_action.sql",
  ),
  "utf8",
);

async function expectDatabaseError(
  client: pg.PoolClient,
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  await client.query("SAVEPOINT expected_policy_corrected_audit_error");
  try {
    await assert.rejects(
      action,
      (error: unknown) => readDatabaseErrorCode(error) === code,
    );
  } finally {
    await client.query(
      "ROLLBACK TO SAVEPOINT expected_policy_corrected_audit_error",
    );
    await client.query(
      "RELEASE SAVEPOINT expected_policy_corrected_audit_error",
    );
  }
}

test("policy_corrected uses the bounded append-only audit path", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for audit database test");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const actorId = randomUUID();
    const policyId = randomUUID();
    await client.query(
      `INSERT INTO users (id, email, password_hash)
       VALUES ($1, $2, $3)`,
      [actorId, `policy-corrected-${actorId}@example.test`, validPasswordHash],
    );

    const created = await client.query<{ event_id: string }>(
      `SELECT record_audit_event(
         $1::uuid,
         'policy_corrected'::audit_action,
         'policy'::audit_entity_type,
         $2::uuid,
         $3::jsonb,
         $4::jsonb
       ) AS event_id`,
      [
        actorId,
        policyId,
        JSON.stringify({ insuredName: "Before" }),
        JSON.stringify({ insuredName: "After", reason: "Corrected typo" }),
      ],
    );
    const eventId = created.rows[0]?.event_id;
    assert.ok(eventId);

    const stored = await client.query<{
      action: string;
      entity_id: string;
      entity_type: string;
    }>(
      `SELECT action::text, entity_type::text, entity_id::text
       FROM audit_events
       WHERE id = $1`,
      [eventId],
    );
    assert.deepEqual(stored.rows[0], {
      action: "policy_corrected",
      entity_id: policyId,
      entity_type: "policy",
    });

    await expectDatabaseError(client, "22P02", () =>
      client.query("SELECT 'unknown_policy_action'::audit_action"),
    );
    await expectDatabaseError(client, "23514", () =>
      client.query(
        `SELECT record_audit_event(
           $1::uuid,
           'policy_corrected'::audit_action,
           'policy'::audit_entity_type,
           $2::uuid,
           NULL,
           $3::jsonb
         )`,
        [actorId, policyId, JSON.stringify({ nested: { forbidden: true } })],
      ),
    );
    await expectDatabaseError(client, "55000", () =>
      client.query(
        "UPDATE audit_events SET after_summary = '{}'::jsonb WHERE id = $1",
        [eventId],
      ),
    );
    await expectDatabaseError(client, "55000", () =>
      client.query("DELETE FROM audit_events WHERE id = $1", [eventId]),
    );
    await expectDatabaseError(client, "55000", () => client.query(backoutSql));

    const preserved = await client.query<{ event_count: string }>(
      `SELECT count(*)::text AS event_count
       FROM audit_events
       WHERE id = $1
         AND action = 'policy_corrected'::audit_action`,
      [eventId],
    );
    assert.equal(preserved.rows[0]?.event_count, "1");
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
