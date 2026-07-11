import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

test("one migration owns the carriers table", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const tableCreators = readdirSync(migrationDirectory)
    .filter((fileName) => fileName.endsWith(".sql"))
    .filter((fileName) =>
      /CREATE TABLE "carriers"/.test(
        readFileSync(resolve(migrationDirectory, fileName), "utf8"),
      ),
    );

  assert.deepEqual(tableCreators, ["0010_carriers.sql"]);

  const migrationSql = readFileSync(
    resolve(migrationDirectory, "0010_carriers.sql"),
    "utf8",
  );
  assert.match(migrationSql, /"id" uuid PRIMARY KEY/);
  assert.match(migrationSql, /"name" text NOT NULL/);
  assert.match(migrationSql, /"is_active" boolean DEFAULT true NOT NULL/);
  assert.match(migrationSql, /lower\("name"\)/);
  assert.doesNotMatch(
    migrationSql,
    /mga_id|default_mga|carrier_fee|carrierFee/i,
  );
});

test("carrier backout is scoped to its table", () => {
  const backoutSql = readFileSync(
    resolve(process.cwd(), "drizzle/backout/0010_carriers.sql"),
    "utf8",
  ).trim();

  assert.equal(backoutSql, 'DROP TABLE IF EXISTS "carriers";');
});
