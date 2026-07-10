import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

test("the auth migration is the sole owner of the users table", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const userTableCreators = readdirSync(migrationDirectory)
    .filter((fileName) => fileName.endsWith(".sql"))
    .filter((fileName) => {
      const sql = readFileSync(resolve(migrationDirectory, fileName), "utf8");
      return /CREATE TABLE "users"/.test(sql);
    });

  assert.deepEqual(userTableCreators, ["0001_users.sql"]);

  const authMigration = readFileSync(
    resolve(migrationDirectory, "0001_users.sql"),
    "utf8",
  );
  assert.doesNotMatch(authMigration, /staff_profiles|user_capabilities/i);
});
