import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { readDatabaseErrorCode } from "./error-code.js";
import { auditEvents, users } from "./schema.js";
import * as databaseSchema from "./schema.js";

const VALID_PASSWORD_HASH =
  "$2b$10$DA2BkeOLidNMTWnMvpyAj.I9tWFMwSTWG4LihsLTuEj.F/uK./VMq";

async function expectDatabaseError(
  client: pg.PoolClient,
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  await client.query("SAVEPOINT expected_audit_event_error");
  try {
    await assert.rejects(
      action,
      (error: unknown) => readDatabaseErrorCode(error) === code,
    );
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT expected_audit_event_error");
    await client.query("RELEASE SAVEPOINT expected_audit_event_error");
  }
}

test("audit events require a known actor and bounded object summaries", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for the audit events test");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const database = drizzle(client, { schema: databaseSchema });
  const email = `audit-${randomUUID()}@example.com`;

  try {
    await client.query("BEGIN");
    const [actor] = await database
      .insert(users)
      .values({ email, passwordHash: VALID_PASSWORD_HASH })
      .returning({ id: users.id });
    assert.ok(actor);

    const [created] = await database
      .insert(auditEvents)
      .values({
        action: "policy_override_applied",
        actorUserId: actor.id,
        afterSummary: { field: "commission_amount", reason: "correction" },
        entityId: randomUUID(),
        entityType: "policy",
      })
      .returning();
    assert.ok(created);
    assert.equal(created.beforeSummary, null);
    assert.ok(created.occurredAt instanceof Date);

    await expectDatabaseError(client, "23503", () =>
      database.insert(auditEvents).values({
        action: "policy_override_applied",
        actorUserId: randomUUID(),
        entityId: randomUUID(),
        entityType: "policy",
      }),
    );
    await expectDatabaseError(client, "23514", () =>
      database.execute(sql`
        insert into audit_events (
          actor_user_id, action, entity_type, entity_id, before_summary
        ) values (
          ${actor.id}, 'policy_override_applied', 'policy', ${randomUUID()}, '[1]'::jsonb
        )
      `),
    );
    await expectDatabaseError(client, "23514", () =>
      database.execute(sql`
        insert into audit_events (
          actor_user_id, action, entity_type, entity_id, after_summary
        ) values (
          ${actor.id}, 'policy_override_applied', 'policy', ${randomUUID()},
          jsonb_build_object('reason', repeat('x', 17000))
        )
      `),
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
