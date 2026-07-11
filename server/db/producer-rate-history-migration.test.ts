import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

test("one migration owns the producer rate history table", () => {
  const migrationDirectory = resolve(process.cwd(), "drizzle");
  const migrationFiles = readdirSync(migrationDirectory).filter((fileName) =>
    fileName.endsWith(".sql"),
  );
  const tableCreators = migrationFiles.filter((fileName) => {
    const migrationSql = readFileSync(
      resolve(migrationDirectory, fileName),
      "utf8",
    );

    return /CREATE TABLE "producer_rate_history"/.test(migrationSql);
  });

  assert.deepEqual(tableCreators, ["0006_producer_rate_history.sql"]);

  const migrationSql = readFileSync(
    resolve(migrationDirectory, "0006_producer_rate_history.sql"),
    "utf8",
  );
  assert.match(
    migrationSql,
    /FOREIGN KEY \("producer_user_id"\) REFERENCES "public"\."staff_profiles"\("user_id"\)/,
  );
  assert.match(
    migrationSql,
    /UNIQUE INDEX "producer_rate_history_producer_effective_date_idx"/,
  );
  assert.doesNotMatch(migrationSql, /(?:CREATE|ALTER|DROP) TABLE "users"/i);
  assert.doesNotMatch(
    migrationSql,
    /(?:CREATE|ALTER|DROP) TABLE "staff_profiles"/i,
  );
});

test("producer rate history has a scoped backout statement", () => {
  const backoutSql = readFileSync(
    resolve(
      process.cwd(),
      "drizzle/backout/0006_producer_rate_history.sql",
    ),
    "utf8",
  ).trim();

  assert.equal(backoutSql, 'DROP TABLE IF EXISTS "producer_rate_history";');
});
