import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

test("one migration owns the policy core table without premature foreign keys", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const tableCreators = readdirSync(migrationDirectory)
    .filter((fileName) => fileName.endsWith(".sql"))
    .filter((fileName) =>
      /CREATE TABLE "policies"/.test(
        readFileSync(resolve(migrationDirectory, fileName), "utf8"),
      ),
    );

  assert.deepEqual(tableCreators, ["0015_policies.sql"]);

  const migrationSql = readFileSync(
    resolve(migrationDirectory, "0015_policies.sql"),
    "utf8",
  );
  assert.match(migrationSql, /"kaylee_split" "account_assignment"/);
  assert.match(migrationSql, /"transaction_type" text NOT NULL/);
  assert.match(migrationSql, /"finance_contact" jsonb/);
  assert.match(migrationSql, /"ipfs_pushed_at" timestamp with time zone/);
  assert.match(migrationSql, /"mga_paid" boolean DEFAULT false NOT NULL/);
  assert.doesNotMatch(migrationSql, /FOREIGN KEY/);
  assert.doesNotMatch(
    migrationSql,
    /rewrite_subtype|carrier_fee|on_pay_sheets|onPaySheets|budget|premium_total|collected_to_date|balance_due_from_insured|remaining_net_due/i,
  );
});

test("policy core backout is scoped to policies", () => {
  const backoutSql = readFileSync(
    resolve(process.cwd(), "drizzle/backout/0015_policies.sql"),
    "utf8",
  );

  assert.match(backoutSql, /DROP TABLE IF EXISTS "policies"/);
  assert.doesNotMatch(backoutSql, /DROP TABLE IF EXISTS "drafts"/);
  assert.doesNotMatch(backoutSql, /DROP TYPE/);
});
