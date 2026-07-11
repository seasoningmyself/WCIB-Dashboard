import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const EXPECTED_COLUMNS = [
  "account_assignment",
  "amount_paid",
  "base_premium",
  "broker_fee",
  "carrier_id",
  "commission_confirmed",
  "commission_mode",
  "commission_rate",
  "company_name",
  "created_at",
  "deposit_option",
  "effective_date",
  "expiration_date",
  "finance_balance",
  "finance_contact",
  "finance_meta",
  "finance_reference",
  "flag_reason",
  "history",
  "id",
  "insured_name",
  "invoice_number",
  "ipfs_financed",
  "ipfs_manual",
  "ipfs_pushed",
  "ipfs_pushed_at",
  "ipfs_returning",
  "last_edited_at",
  "linked_policy_id",
  "linked_queue_entry_id",
  "mga_fee",
  "mga_id",
  "net_due",
  "notes",
  "office_location_id",
  "owner_user_id",
  "payment_mode",
  "policy_number",
  "policy_type_id",
  "producer_user_id",
  "proposal_total",
  "schema_version",
  "sent_back_at",
  "sent_back_by_user_id",
  "sent_back_reason",
  "status",
  "submitted_at",
  "taxes",
  "transaction_notes",
  "transaction_type",
] as const;

test("one migration owns the explicit drafts schema", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const tableCreators = readdirSync(migrationDirectory)
    .filter((fileName) => fileName.endsWith(".sql"))
    .filter((fileName) =>
      /CREATE TABLE "drafts"/.test(
        readFileSync(resolve(migrationDirectory, fileName), "utf8"),
      ),
    );

  assert.deepEqual(tableCreators, ["0012_drafts.sql"]);

  const migrationSql = readFileSync(
    resolve(migrationDirectory, "0012_drafts.sql"),
    "utf8",
  );
  const createdTables = [...migrationSql.matchAll(/CREATE TABLE "([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(createdTables, ["drafts"]);

  for (const column of EXPECTED_COLUMNS) {
    assert.match(migrationSql, new RegExp(`"${column}"`), column);
  }

  assert.match(
    migrationSql,
    /CREATE TYPE "public"\."draft_status" AS ENUM\('draft', 'submitted', 'flagged', 'sent_back', 'approved'\)/,
  );
  assert.match(migrationSql, /"transaction_type" text/);
  assert.doesNotMatch(
    migrationSql,
    /rewrite_subtype|carrier_fee|budget|balance_due_from_insured|remaining_net_due/i,
  );
});

test("draft backout removes only the draft schema introduced by item 10", () => {
  const backoutSql = readFileSync(
    resolve(process.cwd(), "drizzle/backout/0012_drafts.sql"),
    "utf8",
  );

  assert.match(backoutSql, /DROP TABLE IF EXISTS "drafts"/);
  assert.match(backoutSql, /DROP TYPE IF EXISTS "draft_status"/);
  assert.doesNotMatch(backoutSql, /DROP TABLE IF EXISTS "users"/);
  assert.doesNotMatch(backoutSql, /DROP TABLE IF EXISTS "policy_types"/);
});
