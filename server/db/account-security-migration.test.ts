import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0052_security_first_login_settings.sql"),
  "utf8",
);
const backout = readFileSync(
  resolve(
    process.cwd(),
    "drizzle/backout/0052_security_first_login_settings.sql",
  ),
  "utf8",
);

test("security migration moves canonical names and installs first-login controls", () => {
  const addUserName = migration.indexOf(
    'ALTER TABLE "users" ADD COLUMN "display_name" text',
  );
  const backfillUserName = migration.indexOf('UPDATE "users" AS u');
  const dropStaffName = migration.indexOf(
    'ALTER TABLE "staff_profiles" DROP COLUMN "display_name"',
  );
  assert.ok(addUserName >= 0);
  assert.ok(backfillUserName > addUserName);
  assert.ok(dropStaffName > backfillUserName);
  assert.match(migration, /ADD COLUMN "password_change_required_at"/);
  assert.match(migration, /ADD COLUMN "office_location_id" uuid/);
  assert.match(migration, /CREATE TABLE "login_throttle_buckets"/);
  assert.match(migration, /\$argon2id/);
  assert.match(migration, /'user_password_changed'/);
  assert.match(migration, /'user_profile_changed'/);
  assert.match(migration, /'user_temporary_password_issued'/);
  assert.match(migration, /"expected_migration_count" = 53/);
  assert.match(
    migration,
    /2e9f37930b5a85aa44f6a77184ba013eda6eb246133e5c02dc2a4d1a91d5fd2b/,
  );
});

test("security migration backout restores the 0051 schema contract and refuses data loss", () => {
  assert.match(backout, /user_security_audit_history_in_use/);
  assert.match(backout, /user_security_password_state_in_use/);
  assert.match(backout, /user_security_operational_state_in_use/);
  assert.match(backout, /ADD COLUMN "display_name" text/);
  assert.match(backout, /DROP COLUMN "office_location_id"/);
  assert.match(backout, /DROP TABLE "login_throttle_buckets"/);
  assert.match(backout, /"expected_migration_count" = 52/);
  assert.match(
    backout,
    /0185cf8f1e925f2255f565e7b4e71e99e9db7eae3551518241af40f56cbc7553/,
  );
  assert.ok(
    backout.indexOf('DROP FUNCTION "record_audit_event"') <
      backout.indexOf('ALTER TYPE "audit_action" RENAME'),
  );
});
