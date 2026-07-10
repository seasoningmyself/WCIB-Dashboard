import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

test("one migration owns policy types and its class enum", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const tableCreators = readdirSync(migrationDirectory)
    .filter((fileName) => fileName.endsWith(".sql"))
    .filter((fileName) =>
      /CREATE TABLE "policy_types"/.test(
        readFileSync(resolve(migrationDirectory, fileName), "utf8"),
      ),
    );

  assert.deepEqual(tableCreators, ["0011_policy_types.sql"]);

  const migrationSql = readFileSync(
    resolve(migrationDirectory, "0011_policy_types.sql"),
    "utf8",
  );
  assert.match(
    migrationSql,
    /CREATE TYPE "public"\."policy_type_class" AS ENUM\('Personal', 'Commercial', 'Life-Health'\)/,
  );
  assert.match(migrationSql, /"class_tag" "policy_type_class" NOT NULL/);
  assert.match(migrationSql, /lower\("name"\)/);
  assert.doesNotMatch(migrationSql, /budget|transaction_type/i);
});

test("policy type backout removes the table before its enum", () => {
  const backoutSql = readFileSync(
    resolve(process.cwd(), "drizzle/backout/0011_policy_types.sql"),
    "utf8",
  );
  const tablePosition = backoutSql.indexOf('DROP TABLE IF EXISTS "policy_types"');
  const enumPosition = backoutSql.indexOf(
    'DROP TYPE IF EXISTS "policy_type_class"',
  );

  assert.ok(tablePosition >= 0);
  assert.ok(enumPosition > tablePosition);
});
