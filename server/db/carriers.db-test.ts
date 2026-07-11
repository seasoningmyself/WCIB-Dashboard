import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { carriers } from "./schema.js";
import * as databaseSchema from "./schema.js";
import { readDatabaseErrorCode } from "./error-code.js";

test("carriers preserve UUID identity and normalized unique names", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for the carrier smoke test");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const database = drizzle(pool, { schema: databaseSchema });
  const uniqueName = `Carrier ${randomUUID()}`;
  let carrierId: string | undefined;

  try {
    const [carrier] = await database
      .insert(carriers)
      .values({ name: uniqueName })
      .returning();
    assert.ok(carrier);
    carrierId = carrier.id;
    assert.match(carrier.id, /^[0-9a-f-]{36}$/);
    assert.equal(carrier.isActive, true);

    await assert.rejects(
      database.insert(carriers).values({ name: uniqueName.toUpperCase() }),
      (error: unknown) => readDatabaseErrorCode(error) === "23505",
    );
    await assert.rejects(
      database.insert(carriers).values({ name: ` ${uniqueName}` }),
      (error: unknown) => readDatabaseErrorCode(error) === "23514",
    );

    await database
      .update(carriers)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(carriers.id, carrier.id));
    const [deactivated] = await database
      .select()
      .from(carriers)
      .where(eq(carriers.id, carrier.id));
    assert.equal(deactivated?.id, carrier.id);
    assert.equal(deactivated?.name, uniqueName);
    assert.equal(deactivated?.isActive, false);
  } finally {
    if (carrierId !== undefined) {
      await database.delete(carriers).where(eq(carriers.id, carrierId));
    }
    await pool.end();
  }
});
