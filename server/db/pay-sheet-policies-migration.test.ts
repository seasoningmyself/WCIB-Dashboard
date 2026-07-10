import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  PAY_SHEET_POLICY_SNAPSHOT_FIELDS,
  PAY_SHEET_RATE_SNAPSHOT_FIELDS,
} from "../../shared/pay-sheet-snapshots.js";

const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle/0026_pay_sheet_policies.sql"),
  "utf8",
);
const backoutSql = readFileSync(
  resolve(process.cwd(), "drizzle/backout/0026_pay_sheet_policies.sql"),
  "utf8",
);

test("one migration owns normalized pay-sheet policy snapshots", () => {
  const migrations = readdirSync(resolve(process.cwd(), "drizzle")).filter(
    (name) => /^0026_.*\.sql$/.test(name),
  );

  assert.deepEqual(migrations, ["0026_pay_sheet_policies.sql"]);
  assert.match(migrationSql, /CREATE TABLE "pay_sheet_policies"/);
  for (const column of [
    "id",
    "pay_sheet_id",
    "policy_id",
    "added_at",
    "frozen_policy_snapshot",
    "producer_rate_history_id",
    "frozen_rate_snapshot",
    "created_at",
  ]) {
    assert.match(migrationSql, new RegExp(`"${column}"`));
  }
  assert.equal(
    [
      ...migrationSql.matchAll(
        /REFERENCES "public"\."(?:pay_sheets|policies|producer_rate_history)"/g,
      ),
    ].length,
    3,
  );
  assert.equal([...migrationSql.matchAll(/ON DELETE restrict/g)].length, 3);
  assert.match(migrationSql, /pay_sheet_policies_sheet_policy_unique_idx/);
  assert.match(migrationSql, /pay_sheet_policies_policy_idx/);
  for (const field of [
    ...PAY_SHEET_POLICY_SNAPSHOT_FIELDS,
    ...PAY_SHEET_RATE_SNAPSHOT_FIELDS,
  ]) {
    assert.match(migrationSql, new RegExp(`'${field}'`));
  }
  assert.doesNotMatch(
    migrationSql,
    /carrier_fee|carrierFee|rewriteSubtype|rewrite_subtype|CREATE FUNCTION|CREATE TRIGGER/i,
  );
});

test("pay-sheet policy backout is unused-only and preserves dependencies", () => {
  assert.match(backoutSql, /DROP TABLE IF EXISTS "pay_sheet_policies"/);
  assert.match(backoutSql, /forward-fix/i);
  assert.doesNotMatch(
    backoutSql,
    /DROP TABLE.*"(?:pay_sheets|policies|producer_rate_history)"|DELETE FROM|TRUNCATE/i,
  );
});
