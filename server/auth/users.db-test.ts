import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as databaseSchema from "../db/schema.js";
import { users } from "../db/schema.js";
import { verifyPassword } from "./password.js";
import {
  createUser,
  DuplicateUserEmailError,
  findUserById,
  findUserCredentialsByEmail,
} from "./users.js";

test("users persist UUID identity and enforce credential constraints", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for the user model smoke test");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const database = drizzle(pool, { schema: databaseSchema });
  const email = `wcib-user-${randomUUID()}@example.test`;
  let accountId: string | undefined;

  try {
    const account = await createUser(database, {
      email: email.toUpperCase(),
      password: "StrongPass123!",
    });
    accountId = account.id;

    assert.match(account.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(account.id, account.email);
    assert.equal(account.email, email);
    assert.equal(account.isActive, true);
    assert.equal(account.sessionVersion, 0);
    assert.equal("passwordHash" in account, false);

    const credentials = await findUserCredentialsByEmail(
      database,
      email.toUpperCase(),
    );
    assert.ok(credentials);
    assert.equal(credentials.account.id, account.id);
    assert.equal(
      await verifyPassword("StrongPass123!", credentials.passwordHash),
      true,
    );

    await database
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, account.id));
    assert.equal((await findUserById(database, account.id))?.isActive, false);

    await assert.rejects(
      createUser(database, {
        email: `  ${email.toUpperCase()}  `,
        password: "AnotherPass123!",
      }),
      (error: unknown) => {
        assert.ok(error instanceof DuplicateUserEmailError);
        assert.equal(error.message.includes(email), false);
        return true;
      },
    );
  } finally {
    if (accountId !== undefined) {
      await database.delete(users).where(eq(users.id, accountId));
    }
    await pool.end();
  }
});
