import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { test } from "node:test";
import {
  assertMigrationPlanIsTransactional,
  findNontransactionalStatement,
  loadMigrationPlan,
} from "./migration-plan.js";

test("every journaled migration has ordered forward and backout SQL", () => {
  const plan = loadMigrationPlan();

  assert.equal(plan.length, 53);
  assert.deepEqual(
    plan.map((entry) => entry.idx),
    Array.from({ length: 53 }, (_, index) => index),
  );
  for (const entry of plan) {
    assert.equal(basename(entry.forwardPath), `${entry.tag}.sql`);
    assert.equal(basename(entry.backoutPath), `${entry.tag}.sql`);
    assert.ok(entry.forwardStatements.length > 0);
    assert.ok(entry.backoutStatements.length > 0);
    assert.match(entry.forwardHash, /^[a-f0-9]{64}$/);
  }
});

test("the current migration plan is fully transactional", () => {
  assert.doesNotThrow(() => assertMigrationPlanIsTransactional(loadMigrationPlan()));
});

test("the reviewed runbook inventories every migration exactly once", () => {
  const documentation = readFileSync(
    new URL("../../docs/MIGRATION_SAFETY.md", import.meta.url),
    "utf8",
  );

  for (const entry of loadMigrationPlan()) {
    assert.equal(
      documentation.match(new RegExp(`\\| \`${entry.tag}\` \\|`, "g"))?.length,
      1,
      `${entry.tag} needs one reviewed inventory row`,
    );
  }
});

test("nontransactional SQL requires a separate reviewed recovery procedure", () => {
  assert.match(
    findNontransactionalStatement([
      "CREATE INDEX CONCURRENTLY example_idx ON example (id)",
    ]) ?? "",
    /CONCURRENTLY/,
  );
  assert.match(
    findNontransactionalStatement([
      "ALTER TYPE example_state ADD VALUE 'new'",
    ]) ?? "",
    /ADD VALUE/,
  );
});
