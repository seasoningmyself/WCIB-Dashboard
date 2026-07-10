import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { readDatabaseErrorCode } from "./error-code.js";
import { policyTypes } from "./schema.js";
import * as databaseSchema from "./schema.js";

test("policy types require the three approved classes and stable identity", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(
    databaseUrl,
    "DATABASE_URL is required for the policy types smoke test",
  );

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const database = drizzle(pool, { schema: databaseSchema });
  const runId = randomUUID();
  const ids: string[] = [];

  try {
    const rows = await database
      .insert(policyTypes)
      .values([
        { classTag: "Personal", name: `Personal ${runId}` },
        { classTag: "Commercial", name: `Commercial ${runId}` },
        { classTag: "Life-Health", name: `Life-Health ${runId}` },
      ])
      .returning();
    ids.push(...rows.map((row) => row.id));

    assert.deepEqual(
      rows.map((row) => row.classTag),
      ["Personal", "Commercial", "Life-Health"],
    );
    assert.ok(rows.every((row) => /^[0-9a-f-]{36}$/.test(row.id)));

    await assert.rejects(
      database.insert(policyTypes).values({
        classTag: "Personal",
        name: `PERSONAL ${runId}`,
      }),
      (error: unknown) => readDatabaseErrorCode(error) === "23505",
    );
    await assert.rejects(
      database.execute(
        sql`insert into policy_types (name, class_tag) values (${`Invalid ${runId}`}, ${"Business"})`,
      ),
      (error: unknown) => readDatabaseErrorCode(error) === "22P02",
    );

    const first = rows[0];
    assert.ok(first);
    await database
      .update(policyTypes)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(policyTypes.id, first.id));
    const [deactivated] = await database
      .select()
      .from(policyTypes)
      .where(eq(policyTypes.id, first.id));
    assert.equal(deactivated?.isActive, false);
    assert.equal(deactivated?.classTag, "Personal");
  } finally {
    if (ids.length > 0) {
      await database.delete(policyTypes).where(inArray(policyTypes.id, ids));
    }
    await pool.end();
  }
});
