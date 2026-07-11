import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createUser } from "../auth/users.js";
import { buildPaySheetFrozenTotals } from "../pay-sheets/frozen-totals.js";
import { readDatabaseErrorCode } from "./error-code.js";
import { paySheets, users } from "./schema.js";
import * as databaseSchema from "./schema.js";

let savepointSequence = 0;

async function expectDatabaseError(
  client: pg.PoolClient,
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  const savepoint = `expected_pay_sheet_error_${savepointSequence++}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await assert.rejects(
      action,
      (error: unknown) => readDatabaseErrorCode(error) === code,
    );
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  }
}

test("pay sheets enforce UUID ownership, monthly identity, and frozen totals", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for pay-sheet DB test");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const database = drizzle(client, { schema: databaseSchema });

  try {
    await client.query("BEGIN");
    const sophia = await createUser(database, {
      email: `pay-sheet-sophia-${randomUUID()}@example.test`,
      password: "StrongPass123!",
    });
    const producer = await createUser(database, {
      email: `pay-sheet-producer-${randomUUID()}@example.test`,
      password: "StrongPass123!",
    });
    const closer = await createUser(database, {
      email: `pay-sheet-closer-${randomUUID()}@example.test`,
      password: "StrongPass123!",
    });
    const createdAt = new Date("2026-06-01T12:00:00.000Z");
    const closedAt = new Date("2026-07-01T12:00:00.000Z");

    const [openSheet] = await database
      .insert(paySheets)
      .values({
        createdAt,
        openedAt: createdAt,
        ownerType: "sophia",
        ownerUserId: sophia.id,
        periodMonth: 6,
        periodYear: 2026,
        updatedAt: createdAt,
      })
      .returning();
    assert.ok(openSheet);
    assert.match(openSheet.id, /^[0-9a-f-]{36}$/);
    assert.equal(openSheet.status, "open");
    assert.equal(openSheet.frozenTotals, null);
    assert.equal(openSheet.closedAt, null);
    assert.equal(openSheet.closedByUserId, null);

    await expectDatabaseError(client, "23505", () =>
      database.insert(paySheets).values({
        ownerType: "sophia",
        ownerUserId: sophia.id,
        periodMonth: 6,
        periodYear: 2026,
      }),
    );
    for (const [month, year] of [
      [0, 2026],
      [13, 2026],
      [6, 1999],
      [6, 10_000],
    ] as const) {
      await expectDatabaseError(client, "23514", () =>
        database.insert(paySheets).values({
          ownerType: "producer",
          ownerUserId: producer.id,
          periodMonth: month,
          periodYear: year,
        }),
      );
    }
    await expectDatabaseError(client, "23514", () =>
      database.insert(paySheets).values({
        closedAt,
        closedByUserId: closer.id,
        ownerType: "producer",
        ownerUserId: producer.id,
        periodMonth: 6,
        periodYear: 2026,
      }),
    );
    await expectDatabaseError(client, "23514", () =>
      database.insert(paySheets).values({
        createdAt,
        openedAt: createdAt,
        ownerType: "producer",
        ownerUserId: producer.id,
        periodMonth: 6,
        periodYear: 2026,
        updatedAt: new Date("2026-05-31T12:00:00.000Z"),
      }),
    );
    await expectDatabaseError(client, "23503", () =>
      database.insert(paySheets).values({
        ownerType: "producer",
        ownerUserId: randomUUID(),
        periodMonth: 6,
        periodYear: 2026,
      }),
    );
    await expectDatabaseError(client, "22P02", () =>
      client.query(
        `insert into pay_sheets (
           owner_user_id, owner_type, period_month, period_year
         ) values ($1::uuid, 'employee', 6, 2026)`,
        [producer.id],
      ),
    );

    const sophiaTotals = buildPaySheetFrozenTotals("sophia", {
      brokerFees: "1000.00",
      commissions: "500.00",
      directCheckAchIncome: "200.00",
      grandTotalIncome: "1700.00",
      sophiaAgencyGross: "1700.00",
      sophiaShare: "1200.00",
      sophiaTakeHome: "1400.00",
      trustPull: "1500.00",
    });
    const [closedSophiaSheet] = await database
      .insert(paySheets)
      .values({
        closedAt,
        closedByUserId: closer.id,
        createdAt,
        frozenTotals: sophiaTotals,
        openedAt: createdAt,
        ownerType: "sophia",
        ownerUserId: sophia.id,
        periodMonth: 5,
        periodYear: 2026,
        status: "closed",
        updatedAt: closedAt,
      })
      .returning();
    assert.ok(closedSophiaSheet);
    assert.deepEqual(closedSophiaSheet.frozenTotals, sophiaTotals);
    assert.notEqual(
      (closedSophiaSheet.frozenTotals as Record<string, string>)
        .sophiaAgencyGross,
      (closedSophiaSheet.frozenTotals as Record<string, string>)
        .sophiaTakeHome,
    );

    const producerTotals = buildPaySheetFrozenTotals("producer", {
      brokerFees: "250.00",
      commissions: "100.00",
      directCheckAchIncome: "0.00",
      grandTotalIncome: "350.00",
      producerPayout: "87.50",
      trustPull: "350.00",
    });
    const [closedProducerSheet] = await database
      .insert(paySheets)
      .values({
        closedAt,
        closedByUserId: closer.id,
        createdAt,
        frozenTotals: producerTotals,
        openedAt: createdAt,
        ownerType: "producer",
        ownerUserId: producer.id,
        periodMonth: 6,
        periodYear: 2026,
        status: "closed",
        updatedAt: closedAt,
      })
      .returning();
    assert.ok(closedProducerSheet);
    assert.equal(
      (closedProducerSheet.frozenTotals as Record<string, string>)
        .producerPayout,
      "87.50",
    );

    for (const invalidTotals of [
      { ...sophiaTotals, producerPayout: "1.00" },
      { ...sophiaTotals, sophiaTakeHome: 1400 },
      { brokerFees: "1000.00" },
    ]) {
      await expectDatabaseError(client, "23514", () =>
        database.insert(paySheets).values({
          frozenTotals: invalidTotals,
          ownerType: "sophia",
          ownerUserId: sophia.id,
          periodMonth: 4,
          periodYear: 2026,
          status: "closed",
        }),
      );
    }
    await expectDatabaseError(client, "23503", () =>
      database.insert(paySheets).values({
        closedByUserId: randomUUID(),
        ownerType: "sophia",
        ownerUserId: sophia.id,
        periodMonth: 4,
        periodYear: 2026,
        status: "closed",
      }),
    );
    await expectDatabaseError(client, "23001", () =>
      database.delete(users).where(eq(users.id, sophia.id)),
    );
    await expectDatabaseError(client, "23001", () =>
      database.delete(users).where(eq(users.id, closer.id)),
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
