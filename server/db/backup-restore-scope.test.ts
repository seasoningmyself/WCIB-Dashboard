import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { coreSchemaTables } from "./core-schema-contract.js";

interface SnapshotColumn {
  type: string;
}

interface SnapshotForeignKey {
  columnsFrom: string[];
  name: string;
  onDelete: string;
  tableFrom: string;
}

interface SnapshotTable {
  columns: Record<string, SnapshotColumn>;
  foreignKeys: Record<string, SnapshotForeignKey>;
  name: string;
}

interface DrizzleSnapshot {
  tables: Record<string, SnapshotTable>;
}

const documentation = readFileSync(
  resolve(process.cwd(), "docs/BACKUP_RESTORE_SCOPE.md"),
  "utf8",
);
const schemaSource = readFileSync(
  resolve(process.cwd(), "server/db/schema.ts"),
  "utf8",
);
const snapshot = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "drizzle/meta/0043_snapshot.json"),
    "utf8",
  ),
) as DrizzleSnapshot;

test("Core Schema has only the approved normalized table inventory", () => {
  const schemaTables = [...schemaSource.matchAll(/pgTable\(\s*"([^"]+)"/g)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined)
    .sort();
  const snapshotTables = Object.values(snapshot.tables)
    .map((table) => table.name)
    .sort();

  assert.deepEqual(schemaTables, [...coreSchemaTables]);
  assert.deepEqual(snapshotTables, [...coreSchemaTables]);
  assert.equal(
    coreSchemaTables.some((name) => /backup|restore|export|staging/i.test(name)),
    false,
  );
});

test("foreign keys use UUID identity and cannot orphan domain records", () => {
  const cascadeNames: string[] = [];

  for (const table of Object.values(snapshot.tables)) {
    for (const column of Object.values(table.columns)) {
      assert.doesNotMatch(column.type, /\[\]$/, `${table.name} has an array column`);
    }
    for (const foreignKey of Object.values(table.foreignKeys)) {
      assert.ok(
        foreignKey.onDelete === "restrict" || foreignKey.onDelete === "cascade",
        `${foreignKey.name} has an unreviewed delete action`,
      );
      for (const columnName of foreignKey.columnsFrom) {
        assert.equal(
          table.columns[columnName]?.type,
          "uuid",
          `${foreignKey.name} is not UUID-backed`,
        );
      }
      if (foreignKey.onDelete === "cascade") {
        cascadeNames.push(foreignKey.name);
      }
    }
  }

  assert.deepEqual(cascadeNames.sort(), [
    "password_reset_tokens_user_id_users_id_fk",
    "user_mfa_method_placeholders_user_id_user_mfa_settings_user_id_fk",
    "user_mfa_settings_user_id_users_id_fk",
  ]);
});

test("future restore order and integrity boundaries are explicit", () => {
  const orderedSteps = [
    "1. `users`.",
    "2. `staff_profiles`, `user_capabilities`, and `producer_rate_history`.",
    "3. Controlled vocabularies",
    "4. `drafts` and `approval_queue_entries`.",
    "5. `policies`.",
    "6. `policy_change_requests`, `audit_events`, `policy_overrides`, and `mga_payments`.",
    "7. `pay_sheets` and `pay_sheet_policies`",
    "8. `pay_sheet_adjustments`.",
    "9. `kpi_targets`.",
  ];
  let previousIndex = -1;
  for (const step of orderedSteps) {
    const index = documentation.indexOf(step);
    assert.ok(index > previousIndex, `restore step is missing or out of order: ${step}`);
    previousIndex = index;
  }

  for (const requirement of [
    "DEFERRABLE INITIALLY DEFERRED",
    "must not disable triggers or constraints",
    "Never reconstruct ownership from display names",
    "Preserve closed pay-sheet totals",
    "Preserve audit events and overrides append-only",
    "No such bypass or procedure exists in Core Schema",
  ]) {
    assert.match(documentation, new RegExp(requirement));
  }
});

test("no backup or restore runtime was introduced", () => {
  const runtimeFiles = readdirSync(resolve(process.cwd(), "server"), {
    recursive: true,
  })
    .filter((name) => typeof name === "string")
    .filter((name) => name !== "db/core-schema-contract.ts")
    .filter((name) => !name.endsWith(".test.ts") && !name.endsWith(".db-test.ts"))
    .filter((name) => name.endsWith(".ts"));

  for (const name of runtimeFiles) {
    const source = readFileSync(resolve(process.cwd(), "server", name), "utf8");
    assert.doesNotMatch(source, /\/api\/[^"']*(?:backup|restore)/i, name);
    assert.doesNotMatch(source, /\bexport_jobs\b|\bbackup_staging\b/i, name);
  }
});
