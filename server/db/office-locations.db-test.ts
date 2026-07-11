import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { readDatabaseErrorCode } from "./error-code.js";
import * as databaseSchema from "./schema.js";
import { officeLocations } from "./schema.js";

test("office locations preserve UUID identity and normalized unique names", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(
    databaseUrl,
    "DATABASE_URL is required for the office locations smoke test",
  );

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const database = drizzle(pool, { schema: databaseSchema });
  const uniqueName = `Chicago ${randomUUID()}`;
  let locationId: string | undefined;

  try {
    const [location] = await database
      .insert(officeLocations)
      .values({ name: uniqueName })
      .returning();
    assert.ok(location);
    locationId = location.id;
    assert.match(location.id, /^[0-9a-f-]{36}$/);
    assert.equal(location.isActive, true);

    await assert.rejects(
      database.insert(officeLocations).values({
        name: uniqueName.toUpperCase(),
      }),
      (error: unknown) => readDatabaseErrorCode(error) === "23505",
    );
    await assert.rejects(
      database.insert(officeLocations).values({ name: "   " }),
      (error: unknown) => readDatabaseErrorCode(error) === "23514",
    );

    const renamed = `${uniqueName} Office`;
    await database
      .update(officeLocations)
      .set({ isActive: false, name: renamed, updatedAt: new Date() })
      .where(eq(officeLocations.id, location.id));

    const [deactivated] = await database
      .select()
      .from(officeLocations)
      .where(eq(officeLocations.id, location.id));
    assert.equal(deactivated?.id, location.id);
    assert.equal(deactivated?.name, renamed);
    assert.equal(deactivated?.isActive, false);
  } finally {
    if (locationId !== undefined) {
      await database
        .delete(officeLocations)
        .where(eq(officeLocations.id, locationId));
    }
    await pool.end();
  }
});
