import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

test("one migration owns the MGA table", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const tableCreators = readdirSync(migrationDirectory)
    .filter((fileName) => fileName.endsWith(".sql"))
    .filter((fileName) =>
      /CREATE TABLE "mgas"/.test(
        readFileSync(resolve(migrationDirectory, fileName), "utf8"),
      ),
    );

  assert.deepEqual(tableCreators, ["0009_mgas.sql"]);

  const migrationSql = readFileSync(
    resolve(migrationDirectory, "0009_mgas.sql"),
    "utf8",
  );
  assert.match(migrationSql, /"id" uuid PRIMARY KEY/);
  assert.match(migrationSql, /"name" text NOT NULL/);
  assert.match(migrationSql, /"is_active" boolean DEFAULT true NOT NULL/);
  assert.match(migrationSql, /lower\("name"\)/);
  assert.doesNotMatch(
    migrationSql,
    /carrier_mga|default_mga|carrier_id|policy_id/i,
  );
});

test("MGA backout is scoped to its table", () => {
  const backoutSql = readFileSync(
    resolve(process.cwd(), "drizzle/backout/0009_mgas.sql"),
    "utf8",
  ).trim();

  assert.equal(backoutSql, 'DROP TABLE IF EXISTS "mgas";');
});
