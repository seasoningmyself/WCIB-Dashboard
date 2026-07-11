import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createUser } from "../auth/users.js";
import * as databaseSchema from "../db/schema.js";
import { staffProfiles, users } from "../db/schema.js";
import { listDraftAssignmentOptions } from "./assignment-options.js";

test("draft assignments list only active producer identities in display order", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(
    databaseUrl,
    "DATABASE_URL is required for the draft assignment options database test",
  );
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const database = drizzle(pool, { schema: databaseSchema });
  const runId = randomUUID();
  const userIds: string[] = [];

  try {
    const accounts: Array<{ id: string; name: string }> = [];
    for (const name of [
      "Zeta Producer",
      "alpha Producer",
      "Inactive Profile",
      "Inactive Login",
      "Employee",
    ]) {
      const account = await createUser(database, {
        email: `${name.toLowerCase().replaceAll(" ", ".")}.${runId}@example.test`,
        password: "StrongPass123!",
      });
      userIds.push(account.id);
      accounts.push({ id: account.id, name });
    }
    const idFor = (name: string) => {
      const account = accounts.find((candidate) => candidate.name === name);
      assert.ok(account);
      return account.id;
    };

    await database.insert(staffProfiles).values([
      {
        displayName: `STONE-99 ${runId} Zeta Producer`,
        role: "producer",
        userId: idFor("Zeta Producer"),
      },
      {
        displayName: `STONE-99 ${runId} alpha Producer`,
        role: "producer",
        userId: idFor("alpha Producer"),
      },
      {
        displayName: `STONE-99 ${runId} Inactive Profile`,
        isActive: false,
        role: "producer",
        userId: idFor("Inactive Profile"),
      },
      {
        displayName: `STONE-99 ${runId} Inactive Login`,
        role: "producer",
        userId: idFor("Inactive Login"),
      },
      {
        displayName: `STONE-99 ${runId} Employee`,
        role: "employee",
        userId: idFor("Employee"),
      },
    ]);
    await database
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, idFor("Inactive Login")));

    const options = (await listDraftAssignmentOptions(database)).filter(
      ({ userId }) => userIds.includes(userId),
    );
    assert.deepEqual(options, [
      {
        displayName: `STONE-99 ${runId} alpha Producer`,
        userId: idFor("alpha Producer"),
      },
      {
        displayName: `STONE-99 ${runId} Zeta Producer`,
        userId: idFor("Zeta Producer"),
      },
    ]);
    assert.equal(
      options.every(
        (option) =>
          Object.keys(option).sort().join(",") === "displayName,userId",
      ),
      true,
    );
  } finally {
    if (userIds.length > 0) {
      await database
        .delete(staffProfiles)
        .where(inArray(staffProfiles.userId, userIds));
      await database.delete(users).where(inArray(users.id, userIds));
    }
    await pool.end();
  }
});
