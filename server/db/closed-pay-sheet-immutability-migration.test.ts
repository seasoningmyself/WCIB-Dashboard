import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle/0029_closed_pay_sheet_immutability.sql"),
  "utf8",
);
const backoutSql = readFileSync(
  resolve(
    process.cwd(),
    "drizzle/backout/0029_closed_pay_sheet_immutability.sql",
  ),
  "utf8",
);

test("closed-sheet integrity migration protects only named parent fields and all child writes", () => {
  const migrationNames = readdirSync(resolve(process.cwd(), "drizzle")).filter(
    (name) => /^002[7-9]_.*\.sql$/.test(name),
  );
  assert.deepEqual(migrationNames, [
    "0027_mga_pay_sheet_attachment.sql",
    "0028_pay_sheet_close.sql",
    "0029_closed_pay_sheet_immutability.sql",
  ]);
  assert.match(
    migrationSql,
    /BEFORE UPDATE OF\s*"status",\s*"frozen_totals",\s*"closed_at",\s*"closed_by_user_id"\s*ON "pay_sheets"/,
  );
  assert.match(migrationSql, /IF OLD\."status" = 'closed'/);
  assert.match(
    migrationSql,
    /BEFORE INSERT OR UPDATE OR DELETE ON "pay_sheet_policies"/,
  );
  assert.match(migrationSql, /FOR SHARE/);
  assert.match(migrationSql, /closed_pay_sheet_child_immutable/);
  assert.match(migrationSql, /require_open_pay_sheet_for_mutation/);
  assert.doesNotMatch(
    migrationSql,
    /BEFORE UPDATE ON "pay_sheets"|AFTER UPDATE|reopen|frozen_totals\s*=/i,
  );
});

test("closed-sheet integrity backout preserves every financial row", () => {
  assert.match(backoutSql, /DROP TRIGGER IF EXISTS/);
  assert.match(backoutSql, /forward-fix/i);
  assert.doesNotMatch(
    backoutSql,
    /DROP TABLE|DELETE FROM|UPDATE |TRUNCATE|DROP TYPE/i,
  );
});
