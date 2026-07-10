import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle/0025_pay_sheets.sql"),
  "utf8",
);
const backoutSql = readFileSync(
  resolve(process.cwd(), "drizzle/backout/0025_pay_sheets.sql"),
  "utf8",
);

test("one migration owns the UUID monthly pay-sheet table", () => {
  const migrations = readdirSync(resolve(process.cwd(), "drizzle")).filter(
    (name) => /^0025_.*\.sql$/.test(name),
  );

  assert.deepEqual(migrations, ["0025_pay_sheets.sql"]);
  assert.match(
    migrationSql,
    /pay_sheet_owner_type" AS ENUM\('sophia', 'producer'\)/,
  );
  assert.match(
    migrationSql,
    /pay_sheet_status" AS ENUM\('open', 'closed'\)/,
  );
  assert.match(migrationSql, /CREATE TABLE "pay_sheets"/);
  for (const column of [
    "id",
    "owner_user_id",
    "owner_type",
    "period_month",
    "period_year",
    "status",
    "opened_at",
    "frozen_totals",
    "closed_at",
    "closed_by_user_id",
    "created_at",
    "updated_at",
  ]) {
    assert.match(migrationSql, new RegExp(`"${column}"`));
  }
  assert.equal(
    [...migrationSql.matchAll(/REFERENCES "public"\."users"/g)].length,
    2,
  );
  assert.equal([...migrationSql.matchAll(/ON DELETE restrict/g)].length, 2);
  assert.match(migrationSql, /pay_sheets_owner_period_unique_idx/);
  assert.match(migrationSql, /pay_sheets_period_check/);
  assert.match(migrationSql, /pay_sheets_open_state_check/);
  assert.match(migrationSql, /pay_sheets_frozen_totals_check/);
  for (const field of [
    "brokerFees",
    "commissions",
    "trustPull",
    "directCheckAchIncome",
    "grandTotalIncome",
    "producerPayout",
    "sophiaTakeHome",
    "sophiaShare",
    "sophiaAgencyGross",
  ]) {
    assert.match(migrationSql, new RegExp(`'${field}'`));
  }
  assert.doesNotMatch(
    migrationSql,
    /owner_name|policy_ids|policy_snapshot|rate_snapshot|adjustment|CREATE FUNCTION|CREATE TRIGGER/i,
  );
});

test("pay-sheet backout is dependency-ordered and unused-only", () => {
  assert.ok(
    backoutSql.indexOf('DROP TABLE IF EXISTS "pay_sheets"') <
      backoutSql.indexOf('DROP TYPE IF EXISTS "pay_sheet_status"'),
  );
  assert.match(backoutSql, /forward-fix/i);
  assert.doesNotMatch(
    backoutSql,
    /DROP TABLE.*(?:users|policies)|DELETE FROM|TRUNCATE/i,
  );
});
