import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createUser } from "../auth/users.js";
import { readDatabaseErrorCode } from "./error-code.js";
import * as databaseSchema from "./schema.js";
import {
  producerRateHistory,
  staffProfiles,
  users,
} from "./schema.js";

test("producer rate history preserves dated exact rates and table constraints", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(
    databaseUrl,
    "DATABASE_URL is required for the producer rate history smoke test",
  );

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const database = drizzle(pool, { schema: databaseSchema });
  let producerUserId: string | undefined;

  try {
    const producer = await createUser(database, {
      email: `rate-producer.${randomUUID()}@example.test`,
      password: "StrongPass123!",
    });
    producerUserId = producer.id;

    await database.insert(staffProfiles).values({
      displayName: "Rate Test Producer",
      role: "producer",
      userId: producer.id,
    });

    await database.insert(producerRateHistory).values([
      {
        effectiveDate: "2026-01-01",
        newBrokerRate: "12.30",
        newCommissionRate: "25.10",
        producerUserId: producer.id,
        renewalBrokerRate: "10.20",
        renewalCommissionRate: "20.40",
      },
      {
        effectiveDate: "2026-06-01",
        newBrokerRate: "13.00",
        newCommissionRate: "26.50",
        producerUserId: producer.id,
        renewalBrokerRate: "11.00",
        renewalCommissionRate: "21.50",
      },
    ]);

    const rows = await database
      .select()
      .from(producerRateHistory)
      .where(eq(producerRateHistory.producerUserId, producer.id))
      .orderBy(producerRateHistory.effectiveDate);

    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => ({
        effectiveDate: row.effectiveDate,
        newBrokerRate: row.newBrokerRate,
        newCommissionRate: row.newCommissionRate,
        renewalBrokerRate: row.renewalBrokerRate,
        renewalCommissionRate: row.renewalCommissionRate,
      })),
      [
        {
          effectiveDate: "2026-01-01",
          newBrokerRate: "12.30",
          newCommissionRate: "25.10",
          renewalBrokerRate: "10.20",
          renewalCommissionRate: "20.40",
        },
        {
          effectiveDate: "2026-06-01",
          newBrokerRate: "13.00",
          newCommissionRate: "26.50",
          renewalBrokerRate: "11.00",
          renewalCommissionRate: "21.50",
        },
      ],
    );
    assert.equal(rows[0]?.lockedAt, null);

    await assert.rejects(
      database.insert(producerRateHistory).values({
        effectiveDate: "2026-06-01",
        newBrokerRate: "10.00",
        newCommissionRate: "10.00",
        producerUserId: producer.id,
        renewalBrokerRate: "10.00",
        renewalCommissionRate: "10.00",
      }),
      (error: unknown) => readDatabaseErrorCode(error) === "23505",
    );

    await assert.rejects(
      database.insert(producerRateHistory).values({
        effectiveDate: "2027-01-01",
        newBrokerRate: "10.00",
        newCommissionRate: "100.01",
        producerUserId: producer.id,
        renewalBrokerRate: "10.00",
        renewalCommissionRate: "10.00",
      }),
      (error: unknown) => readDatabaseErrorCode(error) === "23514",
    );

    await assert.rejects(
      database.insert(producerRateHistory).values({
        effectiveDate: "2027-01-01",
        newBrokerRate: "10.00",
        newCommissionRate: "10.00",
        producerUserId: randomUUID(),
        renewalBrokerRate: "10.00",
        renewalCommissionRate: "10.00",
      }),
      (error: unknown) => readDatabaseErrorCode(error) === "23503",
    );
  } finally {
    if (producerUserId !== undefined) {
      await database
        .delete(producerRateHistory)
        .where(eq(producerRateHistory.producerUserId, producerUserId));
      await database
        .delete(staffProfiles)
        .where(eq(staffProfiles.userId, producerUserId));
      await database.delete(users).where(eq(users.id, producerUserId));
    }
    await pool.end();
  }
});
