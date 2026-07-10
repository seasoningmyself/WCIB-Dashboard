import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

test("the staff migration references users without redefining it", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const migrationFiles = readdirSync(migrationDirectory).filter((fileName) =>
    fileName.endsWith(".sql"),
  );
  const staffTableCreators = migrationFiles.filter((fileName) => {
    const sql = readFileSync(resolve(migrationDirectory, fileName), "utf8");
    return /CREATE TABLE "staff_profiles"/.test(sql);
  });
  const capabilityTableCreators = migrationFiles.filter((fileName) => {
    const sql = readFileSync(resolve(migrationDirectory, fileName), "utf8");
    return /CREATE TABLE "user_capabilities"/.test(sql);
  });

  assert.deepEqual(staffTableCreators, ["0002_staff_accounts.sql"]);
  assert.deepEqual(capabilityTableCreators, ["0002_staff_accounts.sql"]);

  const staffMigration = readFileSync(
    resolve(migrationDirectory, "0002_staff_accounts.sql"),
    "utf8",
  );
  assert.doesNotMatch(
    staffMigration,
    /(?:CREATE|ALTER|DROP) TABLE "users"/i,
  );
});
