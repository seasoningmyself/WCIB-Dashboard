import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { readDatabaseErrorCode } from "./error-code.js";
import { auditEvents, users } from "./schema.js";
import * as databaseSchema from "./schema.js";

const VALID_PASSWORD_HASH =
  "$2b$10$DA2BkeOLidNMTWnMvpyAj.I9tWFMwSTWG4LihsLTuEj.F/uK./VMq";

test("audit events require a known actor and bounded object summaries", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for the audit events test");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const database = drizzle(pool, { schema: databaseSchema });
  const email = `audit-${randomUUID()}@example.com`;
  let actorId: string | undefined;
  const eventIds: string[] = [];

  try {
    const [actor] = await database
      .insert(users)
      .values({ email, passwordHash: VALID_PASSWORD_HASH })
      .returning({ id: users.id });
    assert.ok(actor);
    actorId = actor.id;

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
    eventIds.push(created.id);
    assert.equal(created.beforeSummary, null);
    assert.ok(created.occurredAt instanceof Date);

    await assert.rejects(
      database.insert(auditEvents).values({
        action: "policy_override_applied",
        actorUserId: randomUUID(),
        entityId: randomUUID(),
        entityType: "policy",
      }),
      (error: unknown) => readDatabaseErrorCode(error) === "23503",
    );
    await assert.rejects(
      database.execute(sql`
        insert into audit_events (
          actor_user_id, action, entity_type, entity_id, before_summary
        ) values (
          ${actor.id}, 'policy_override_applied', 'policy', ${randomUUID()}, '[1]'::jsonb
        )
      `),
      (error: unknown) => readDatabaseErrorCode(error) === "23514",
    );
    await assert.rejects(
      database.execute(sql`
        insert into audit_events (
          actor_user_id, action, entity_type, entity_id, after_summary
        ) values (
          ${actor.id}, 'policy_override_applied', 'policy', ${randomUUID()},
          jsonb_build_object('reason', repeat('x', 17000))
        )
      `),
      (error: unknown) => readDatabaseErrorCode(error) === "23514",
    );
  } finally {
    for (const eventId of eventIds) {
      await database.delete(auditEvents).where(eq(auditEvents.id, eventId));
    }
    if (actorId) {
      await database.delete(users).where(eq(users.id, actorId));
    }
    await pool.end();
  }
});
