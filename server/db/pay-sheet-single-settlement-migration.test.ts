import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle/0030_pay_sheet_single_settlement.sql"),
  "utf8",
);
const backoutSql = readFileSync(
  resolve(process.cwd(), "drizzle/backout/0030_pay_sheet_single_settlement.sql"),
  "utf8",
);

test("single-settlement migration scopes uniqueness to policy and UUID owner chain", () => {
  const migrationNames = readdirSync(resolve(process.cwd(), "drizzle")).filter(
    (name) => /^0029_|^0030_/.test(name),
  );
  assert.deepEqual(migrationNames, [
    "0029_closed_pay_sheet_immutability.sql",
    "0030_pay_sheet_single_settlement.sql",
  ]);
  assert.match(migrationSql, /existing pay-sheet history violates/);
  assert.match(migrationSql, /GROUP BY[\s\S]*psp\."policy_id"[\s\S]*ps\."owner_user_id"[\s\S]*ps\."owner_type"/);
  assert.match(migrationSql, /pg_advisory_xact_lock/);
  assert.match(migrationSql, /hashtextextended/);
  assert.match(
    migrationSql,
    /p_policy_id::text[\s\S]*p_owner_type::text[\s\S]*p_owner_user_id::text/,
  );
  assert.match(
    migrationSql,
    /BEFORE INSERT OR UPDATE OF "pay_sheet_id", "policy_id"[\s\S]*ON "pay_sheet_policies"/,
  );
  assert.match(
    migrationSql,
    /BEFORE UPDATE OF "status", "owner_user_id", "owner_type"[\s\S]*ON "pay_sheets"/,
  );
  assert.match(migrationSql, /pay_sheet_policy_owner_chain_settled/);
  assert.match(migrationSql, /settled_sheet\."status" = 'closed'/);
  assert.doesNotMatch(
    migrationSql,
    /UNIQUE\s*\([^)]*policy_id|owner_name|producer_name/i,
  );
});

test("single-settlement backout cannot alter pay-sheet history", () => {
  assert.match(backoutSql, /DROP TRIGGER IF EXISTS/);
  assert.match(backoutSql, /forward-fix/i);
  assert.doesNotMatch(
    backoutSql,
    /DROP TABLE|DELETE FROM|UPDATE |TRUNCATE|DROP TYPE/i,
  );
});
