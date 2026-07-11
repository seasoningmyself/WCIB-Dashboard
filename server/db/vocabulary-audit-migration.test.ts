import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migrationName = "0035_vocabulary_creation_audit_vocabulary.sql";
const migrationSql = readFileSync(
  resolve(process.cwd(), "drizzle", migrationName),
  "utf8",
);
const backoutSql = readFileSync(
  resolve(process.cwd(), "drizzle/backout", migrationName),
  "utf8",
);
const priorWriterSql = readFileSync(
  resolve(process.cwd(), "drizzle/0033_policy_corrected_audit_action.sql"),
  "utf8",
);

const actions = [
  "carrier_created",
  "policy_type_created",
  "mga_created",
] as const;
const entityTypes = ["carrier", "policy_type", "mga"] as const;

function enumBlock(sql: string, enumName: string): string {
  return (
    sql.match(
      new RegExp(
        `CREATE TYPE "public"\\."${enumName}" AS ENUM\\([\\s\\S]*?\\);`,
      ),
    )?.[0] ?? ""
  );
}

function auditWriterTail(sql: string): string {
  return sql.slice(sql.indexOf('CREATE FUNCTION "record_audit_event"'));
}

test("one migration owns the vocabulary creation audit values", () => {
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
          enumBlock(forward, "audit_action").includes(`'${action}'`) &&
          !enumBlock(backout, "audit_action").includes(`'${action}'`),
      );
    });

  assert.deepEqual(owners, [migrationName]);
  for (const value of [...actions, ...entityTypes]) {
    assert.equal(
      [...migrationSql.matchAll(new RegExp(`'${value}'`, "g"))].length,
      1,
      value,
    );
  }
});

test("migration preserves the transactional bounded append-only writer", () => {
  assert.doesNotMatch(migrationSql, /ALTER TYPE[\s\S]*ADD VALUE/i);
  assert.match(migrationSql, /ALTER COLUMN "action" TYPE "audit_action"/);
  assert.match(
    migrationSql,
    /ALTER COLUMN "entity_type" TYPE "audit_entity_type"/,
  );
  assert.equal(auditWriterTail(migrationSql), auditWriterTail(priorWriterSql));
  assert.doesNotMatch(migrationSql, /CREATE TABLE|ALTER TABLE "policies"/);
});

test("pre-use backout refuses to discard vocabulary audit history", () => {
  assert.match(backoutSql, /"action"::text IN/);
  assert.match(backoutSql, /"entity_type"::text IN/);
  assert.match(backoutSql, /preserve audit history and forward-fix/);
  assert.match(backoutSql, /ERRCODE = '55000'/);

  const backoutActions = enumBlock(backoutSql, "audit_action");
  const backoutEntityTypes = enumBlock(backoutSql, "audit_entity_type");
  for (const action of actions) {
    assert.doesNotMatch(backoutActions, new RegExp(action));
  }
  for (const entityType of entityTypes) {
    assert.doesNotMatch(backoutEntityTypes, new RegExp(`'${entityType}'`));
  }
  assert.equal(auditWriterTail(backoutSql), auditWriterTail(priorWriterSql));
  assert.doesNotMatch(backoutSql, /DELETE FROM "audit_events"|TRUNCATE/i);
});
