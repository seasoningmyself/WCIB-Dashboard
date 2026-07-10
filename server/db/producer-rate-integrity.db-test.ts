import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createUser } from "../auth/users.js";
import { readDatabaseErrorCode } from "./error-code.js";
import * as databaseSchema from "./schema.js";
import { producerRateHistory, staffProfiles } from "./schema.js";

async function expectDatabaseError(
  client: pg.PoolClient,
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  await client.query("SAVEPOINT expected_database_error");
  try {
    await assert.rejects(
      action,
      (error: unknown) => readDatabaseErrorCode(error) === code,
    );
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT expected_database_error");
    await client.query("RELEASE SAVEPOINT expected_database_error");
  }
}

test("producer rate integrity permits fresh corrections and freezes locked rows", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(
    databaseUrl,
    "DATABASE_URL is required for the producer rate integrity smoke test",
  );

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const database = drizzle(client, { schema: databaseSchema });

  try {
    await client.query("BEGIN");

    const producer = await createUser(database, {
      email: `rate-integrity.${randomUUID()}@example.test`,
      password: "StrongPass123!",
    });
    await database.insert(staffProfiles).values({
      displayName: "Rate Integrity Producer",
      role: "producer",
      userId: producer.id,
    });

    const [rate] = await database
      .insert(producerRateHistory)
      .values({
        effectiveDate: "2026-01-01",
        newBrokerRate: "10.00",
        newCommissionRate: "20.00",
        producerUserId: producer.id,
        renewalBrokerRate: "8.00",
        renewalCommissionRate: "18.00",
      })
      .returning();
    assert.ok(rate);

    await database
      .update(producerRateHistory)
      .set({
        effectiveDate: "2026-02-01",
        newCommissionRate: "21.50",
      })
      .where(eq(producerRateHistory.id, rate.id));

    const [corrected] = await database
      .select()
      .from(producerRateHistory)
      .where(eq(producerRateHistory.id, rate.id));
    assert.equal(corrected?.effectiveDate, "2026-02-01");
    assert.equal(corrected?.newCommissionRate, "21.50");
    assert.equal(corrected?.lockedAt, null);

    await expectDatabaseError(client, "55000", () =>
      database
        .delete(producerRateHistory)
        .where(eq(producerRateHistory.id, rate.id)),
    );
    await expectDatabaseError(client, "55000", () =>
      database
        .update(producerRateHistory)
        .set({ lockedAt: new Date("2026-03-01T12:00:00.000Z") })
        .where(eq(producerRateHistory.id, rate.id)),
    );
    await expectDatabaseError(client, "22004", () =>
      database.execute(
        sql`select lock_producer_rate_history_for_close(${rate.id}::uuid, ${null}::timestamp with time zone)`,
      ),
    );
    await expectDatabaseError(client, "P0002", () =>
      database.execute(
        sql`select lock_producer_rate_history_for_close(${randomUUID()}::uuid, ${"2026-03-01T12:00:00.000Z"}::timestamp with time zone)`,
      ),
    );

    const lockedAt = new Date("2026-03-01T12:00:00.000Z");
    await database.execute(
      sql`select lock_producer_rate_history_for_close(${rate.id}::uuid, ${lockedAt.toISOString()}::timestamp with time zone)`,
    );

    const [locked] = await database
      .select()
      .from(producerRateHistory)
      .where(eq(producerRateHistory.id, rate.id));
    assert.equal(locked?.lockedAt?.toISOString(), lockedAt.toISOString());

    await expectDatabaseError(client, "55000", () =>
      database
        .update(producerRateHistory)
        .set({ newCommissionRate: "22.00" })
        .where(eq(producerRateHistory.id, rate.id)),
    );
    await expectDatabaseError(client, "55000", () =>
      database
        .update(producerRateHistory)
        .set({ lockedAt: null })
        .where(eq(producerRateHistory.id, rate.id)),
    );
    await expectDatabaseError(client, "55000", () =>
      database
        .delete(producerRateHistory)
        .where(eq(producerRateHistory.id, rate.id)),
    );

    await database.execute(
      sql`select lock_producer_rate_history_for_close(${rate.id}::uuid, ${"2026-04-01T12:00:00.000Z"}::timestamp with time zone)`,
    );
    const [stillLocked] = await database
      .select({ lockedAt: producerRateHistory.lockedAt })
      .from(producerRateHistory)
      .where(eq(producerRateHistory.id, rate.id));
    assert.equal(stillLocked?.lockedAt?.toISOString(), lockedAt.toISOString());
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
