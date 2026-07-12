import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "../../shared/audit-events.js";

const migrationName = "0038_producer_commission_receipt_audit_actions.sql";
const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle", migrationName),
  "utf8",
);
const backoutSql = readFileSync(
  resolve(process.cwd(), "drizzle/backout", migrationName),
  "utf8",
);
const priorMigrationSql = readFileSync(
  resolve(process.cwd(), "drizzle/0036_flagged_help_resolution.sql"),
  "utf8",
);
const actions = [
  "producer_commission_receipt_marked",
  "producer_commission_receipt_unmarked",
] as const;

function enumBlock(sql: string): string {
  return (
    sql.match(
      /CREATE TYPE "public"\."audit_action" AS ENUM\([\s\S]*?\);/,
    )?.[0] ?? ""
  );
}

function enumValues(sql: string): string[] {
  return [...enumBlock(sql).matchAll(/'([^']+)'/g)].map((match) => match[1]!);
}

function auditWriter(sql: string): string {
  const start = sql.indexOf('CREATE FUNCTION "record_audit_event"');
  const endMarker = ") FROM PUBLIC;";
  const end = sql.indexOf(endMarker, start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return sql.slice(start, end + endMarker.length);
}

test("one migration owns the producer commission receipt audit actions", () => {
  const owners = readdirSync(resolve(process.cwd(), "drizzle"))
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .filter((name) => {
      const forward = readFileSync(
        resolve(process.cwd(), "drizzle", name),
        "utf8",
      );
      const backout = readFileSync(
        resolve(process.cwd(), "drizzle/backout", name),
        "utf8",
      );
      return actions.some(
        (action) =>
          enumValues(forward).includes(action) &&
          !enumValues(backout).includes(action),
      );
    });

  assert.deepEqual(owners, [migrationName]);
  assert.deepEqual(enumValues(migrationSql).slice(-2), actions);
  assert.deepEqual(
    enumValues(migrationSql).slice(0, -2),
    enumValues(priorMigrationSql),
  );
  assert.deepEqual(enumValues(backoutSql), enumValues(priorMigrationSql));
  for (const action of actions) {
    assert.equal(AUDIT_ACTIONS.filter((entry) => entry === action).length, 1);
  }
  assert.equal(AUDIT_ENTITY_TYPES.filter((entry) => entry === "policy").length, 1);
});

test("migration preserves the bounded append-only audit writer", () => {
  assert.doesNotMatch(migrationSql, /ALTER TYPE[\s\S]*ADD VALUE/i);
  assert.equal(auditWriter(migrationSql), auditWriter(priorMigrationSql));
  assert.equal(auditWriter(backoutSql), auditWriter(priorMigrationSql));
  assert.match(migrationSql, /ALTER COLUMN "action" TYPE "audit_action"/);
  assert.doesNotMatch(
    migrationSql,
    /CREATE TYPE "public"\."audit_entity_type"|ALTER TYPE "audit_entity_type"/,
  );
  assert.doesNotMatch(
    migrationSql,
    /CREATE TABLE|ALTER TABLE "policies"|CREATE TRIGGER/,
  );
  assert.equal(
    [...migrationSql.matchAll(/CREATE FUNCTION /g)].length,
    1,
  );
});

test("pre-use backout refuses to discard receipt audit history", () => {
  assert.match(backoutSql, /"action"::text IN/);
  for (const action of actions) {
    assert.match(backoutSql, new RegExp(`'${action}'`));
    assert.doesNotMatch(enumBlock(backoutSql), new RegExp(action));
  }
  assert.match(backoutSql, /preserve audit history and forward-fix/);
  assert.match(backoutSql, /ERRCODE = '55000'/);
  assert.doesNotMatch(backoutSql, /DELETE FROM "audit_events"|TRUNCATE/i);
  assert.doesNotMatch(backoutSql, /ALTER TABLE "policies"|DROP TABLE/);
});
