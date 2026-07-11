import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

test("one migration owns the office locations table", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const tableCreators = readdirSync(migrationDirectory)
    .filter((fileName) => fileName.endsWith(".sql"))
    .filter((fileName) =>
      /CREATE TABLE "office_locations"/.test(
        readFileSync(resolve(migrationDirectory, fileName), "utf8"),
      ),
    );

  assert.deepEqual(tableCreators, ["0008_office_locations.sql"]);

  const migrationSql = readFileSync(
    resolve(migrationDirectory, "0008_office_locations.sql"),
    "utf8",
  );
  assert.match(migrationSql, /"id" uuid PRIMARY KEY/);
  assert.match(migrationSql, /"name" text NOT NULL/);
  assert.match(migrationSql, /"is_active" boolean DEFAULT true NOT NULL/);
  assert.match(migrationSql, /lower\("name"\)/);
  assert.doesNotMatch(migrationSql, /budget|propert/i);
});

test("office location backout is scoped to its table", () => {
  const backoutSql = readFileSync(
    resolve(process.cwd(), "drizzle/backout/0008_office_locations.sql"),
    "utf8",
  ).trim();

  assert.equal(backoutSql, 'DROP TABLE IF EXISTS "office_locations";');
});
