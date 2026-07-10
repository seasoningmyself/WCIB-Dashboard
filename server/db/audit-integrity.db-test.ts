import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createUser } from "../auth/users.js";
import { readDatabaseErrorCode } from "./error-code.js";
import { auditEvents, users } from "./schema.js";
import * as databaseSchema from "./schema.js";

async function expectDatabaseError(
  client: pg.PoolClient,
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  await client.query("SAVEPOINT expected_audit_error");
  try {
    await assert.rejects(
      action,
      (error: unknown) => readDatabaseErrorCode(error) === code,
    );
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT expected_audit_error");
    await client.query("RELEASE SAVEPOINT expected_audit_error");
  }
}

test("audit writes are append-only and failure rolls back the parent mutation", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for audit integrity test");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const database = drizzle(client, { schema: databaseSchema });

  try {
    await client.query("BEGIN");
    const actor = await createUser(database, {
      email: `audit-integrity-${randomUUID()}@example.test`,
      password: "StrongPass123!",
    });
    const entityId = randomUUID();
    const created = await client.query<{ event_id: string }>(
      `select record_audit_event(
         $1::uuid,
         'staff_account_changed'::audit_action,
         'staff_profile'::audit_entity_type,
         $2::uuid,
         $3::jsonb,
         $4::jsonb
       ) as event_id`,
      [
        actor.id,
        entityId,
        JSON.stringify({ active: false }),
        JSON.stringify({ active: true }),
      ],
    );
    const eventId = created.rows[0]?.event_id;
    assert.ok(eventId);

    await expectDatabaseError(client, "55000", () =>
      database
        .update(auditEvents)
        .set({ afterSummary: { active: false } })
        .where(eq(auditEvents.id, eventId)),
    );
    await expectDatabaseError(client, "55000", () =>
      database.delete(auditEvents).where(eq(auditEvents.id, eventId)),
    );

    await client.query("SAVEPOINT failed_audited_mutation");
    try {
      await database
        .update(users)
        .set({ isActive: false })
        .where(eq(users.id, actor.id));
      await assert.rejects(
        client.query(
          `select record_audit_event(
             $1::uuid,
             'staff_account_changed'::audit_action,
             'staff_profile'::audit_entity_type,
             $1::uuid,
             null,
             $2::jsonb
           )`,
          [actor.id, JSON.stringify({ nested: { forbidden: true } })],
        ),
        (error: unknown) => readDatabaseErrorCode(error) === "23514",
      );
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT failed_audited_mutation");
      await client.query("RELEASE SAVEPOINT failed_audited_mutation");
    }

    const [unchangedActor] = await database
      .select({ isActive: users.isActive })
      .from(users)
      .where(eq(users.id, actor.id));
    assert.equal(unchangedActor?.isActive, true);

    const [unchangedEvent] = await database
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.id, eventId));
    assert.deepEqual(unchangedEvent?.afterSummary, { active: true });
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
