import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle/0032_kpi_targets.sql"),
  "utf8",
);
const backoutSql = readFileSync(
  resolve(process.cwd(), "drizzle/backout/0032_kpi_targets.sql"),
  "utf8",
);

test("one migration owns KPI targets without storing actuals", () => {
  const migrationNames = readdirSync(resolve(process.cwd(), "drizzle")).filter(
    (name) => /^003[1-2]_.*\.sql$/.test(name),
  );
  assert.deepEqual(migrationNames, [
    "0031_pay_sheet_adjustments.sql",
    "0032_kpi_targets.sql",
  ]);
  assert.match(migrationSql, /CREATE TABLE "kpi_targets"/);
  assert.match(migrationSql, /ENUM\('company', 'producer'\)/);
  for (const field of [
    "id",
    "scope_type",
    "producer_user_id",
    "year",
    "new_policy_count_target",
    "new_revenue_target",
    "retention_rate_target",
    "created_at",
    "updated_at",
  ]) {
    assert.match(migrationSql, new RegExp(`"${field}"`));
  }
  assert.match(migrationSql, /kpi_targets_scope_shape_check/);
  assert.match(migrationSql, /kpi_targets_company_year_unique_idx/);
  assert.match(migrationSql, /kpi_targets_producer_year_unique_idx/);
  assert.match(
    migrationSql,
    /REFERENCES "public"\."staff_profiles"\("user_id"\)/,
  );
  assert.doesNotMatch(migrationSql, /actual/i);
});

test("KPI target backout refuses data loss and leaves prior tables alone", () => {
  assert.match(backoutSql, /IF EXISTS \(SELECT 1 FROM "kpi_targets"\)/);
  assert.match(backoutSql, /forward-fix/i);
  assert.match(backoutSql, /DROP TABLE IF EXISTS "kpi_targets"/);
  assert.match(backoutSql, /DROP TYPE IF EXISTS .*kpi_target_scope_type/);
  assert.doesNotMatch(
    backoutSql,
    /DELETE FROM|UPDATE |TRUNCATE|DROP TABLE IF EXISTS "pay_sheets"|DROP TABLE IF EXISTS "staff_profiles"/i,
  );
});
