import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { readDatabaseErrorCode } from "./error-code.js";
import { mgas } from "./schema.js";
import * as databaseSchema from "./schema.js";

test("MGAs preserve UUID identity and normalized unique names", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for the MGA smoke test");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const database = drizzle(pool, { schema: databaseSchema });
  const uniqueName = `MGA ${randomUUID()}`;
  let mgaId: string | undefined;

  try {
    const [mga] = await database
      .insert(mgas)
      .values({ name: uniqueName })
      .returning();
    assert.ok(mga);
    mgaId = mga.id;
    assert.match(mga.id, /^[0-9a-f-]{36}$/);
    assert.equal(mga.isActive, true);

    await assert.rejects(
      database.insert(mgas).values({ name: uniqueName.toUpperCase() }),
      (error: unknown) => readDatabaseErrorCode(error) === "23505",
    );
    await assert.rejects(
      database.insert(mgas).values({ name: ` ${uniqueName} ` }),
      (error: unknown) => readDatabaseErrorCode(error) === "23514",
    );

    await database
      .update(mgas)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(mgas.id, mga.id));
    const [deactivated] = await database
      .select()
      .from(mgas)
      .where(eq(mgas.id, mga.id));
    assert.equal(deactivated?.id, mga.id);
    assert.equal(deactivated?.name, uniqueName);
    assert.equal(deactivated?.isActive, false);
  } finally {
    if (mgaId !== undefined) {
      await database.delete(mgas).where(eq(mgas.id, mgaId));
    }
    await pool.end();
  }
});
