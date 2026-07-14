import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle/0040_pay_sheet_cascade_close.sql"),
  "utf8",
);
const backoutSql = readFileSync(
  resolve(process.cwd(), "drizzle/backout/0040_pay_sheet_cascade_close.sql"),
  "utf8",
);

test("cascade close is a thin atomic wrapper over the proven close function", () => {
  assert.match(
    migrationSql,
    /CREATE FUNCTION "close_pay_sheet_with_cascade"\(\s*"p_pay_sheet_id" uuid,\s*"p_actor_user_id" uuid,\s*"p_cascade_producer_sheets" boolean/,
  );
  assert.match(migrationSql, /PERFORM "require_lifecycle_admin"/);
  assert.match(migrationSql, /target_sheet\."status" = 'closed'/);
  assert.match(migrationSql, /target_sheet\."owner_type" <> 'sophia'/);
  assert.match(migrationSql, /OR NOT p_cascade_producer_sheets/);
  assert.match(migrationSql, /ps\."owner_type" = 'producer'/);
  assert.match(migrationSql, /ps\."status" = 'open'/);
  assert.match(migrationSql, /FROM "pay_sheet_policies" AS psp/);
  assert.match(migrationSql, /ORDER BY\s*ps\."period_year",\s*ps\."period_month",\s*ps\."owner_user_id",\s*ps\."id"/);
  assert.equal(
    (migrationSql.match(/"close_pay_sheet"\(/g) ?? []).length,
    3,
  );
  assert.doesNotMatch(
    migrationSql,
    /frozen_totals|frozen_policy_snapshot|frozen_rate_snapshot|INSERT INTO "audit_events"/,
  );
  assert.match(
    migrationSql,
    /REVOKE ALL ON FUNCTION "close_pay_sheet_with_cascade"/,
  );
});

test("House-only owner chains retain independent open periods", () => {
  const forwardPlacement = migrationSql.slice(
    migrationSql.indexOf(
      'CREATE OR REPLACE FUNCTION "sync_mga_payment_sheet_placement_without_lazy_init"',
    ),
  );
  assert.match(
    forwardPlacement,
    /"owner_user_id" = current_policy\."producer_user_id"\s+AND "status" = 'open'/,
  );
  assert.doesNotMatch(
    forwardPlacement,
    /"period_month" = sophia_sheet\."period_month"|"period_year" = sophia_sheet\."period_year"/,
  );
  assert.match(
    backoutSql,
    /"owner_user_id" = current_policy\."producer_user_id"\s+AND "period_month" = sophia_sheet\."period_month"\s+AND "period_year" = sophia_sheet\."period_year"\s+AND "status" = 'open'/,
  );
});

test("cascade close backout restores placement and removes orchestration", () => {
  assert.match(
    backoutSql,
    /DROP FUNCTION IF EXISTS "close_pay_sheet_with_cascade"/,
  );
  assert.doesNotMatch(backoutSql, /DROP TABLE|TRUNCATE|ALTER TABLE/);
});
