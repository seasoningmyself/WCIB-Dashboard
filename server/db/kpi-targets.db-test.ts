import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createUser } from "../auth/users.js";
import { withDisposableMigratedDatabase } from "./disposable-database-test-helper.js";
import { readDatabaseErrorCode } from "./error-code.js";
import { kpiTargets, staffProfiles } from "./schema.js";
import * as databaseSchema from "./schema.js";

async function expectDatabaseError(
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  await assert.rejects(
    action,
    (error: unknown) => readDatabaseErrorCode(error) === code,
  );
}

test("KPI targets enforce annual company and producer scopes", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for KPI target DB test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_stone69_kpi",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 1 });
      const database = drizzle(pool, { schema: databaseSchema });

      try {
        const producer = await createUser(database, {
          email: `kpi-producer-${randomUUID()}@example.test`,
          password: "StrongPass123!",
        });
        await database.insert(staffProfiles).values({
          displayName: "KPI Producer",
          role: "producer",
          userId: producer.id,
        });

        const [companyTarget] = await database
          .insert(kpiTargets)
          .values({
            newPolicyCountTarget: 120,
            newRevenueTarget: "250000.00",
            retentionRateTarget: "82.50",
            scopeType: "company",
            year: 2026,
          })
          .returning();
        assert.ok(companyTarget);
        assert.match(companyTarget.id, /^[0-9a-f-]{36}$/);
        assert.equal(companyTarget.producerUserId, null);

        const [producerTarget] = await database
          .insert(kpiTargets)
          .values({
            newPolicyCountTarget: 25,
            producerUserId: producer.id,
            scopeType: "producer",
            year: 2026,
          })
          .returning();
        assert.ok(producerTarget);
        assert.equal(producerTarget.producerUserId, producer.id);
        assert.equal(producerTarget.newRevenueTarget, null);
        assert.equal(producerTarget.retentionRateTarget, null);

        await expectDatabaseError("23505", () =>
          database.insert(kpiTargets).values({
            scopeType: "company",
            year: 2026,
          }),
        );
        await expectDatabaseError("23505", () =>
          database.insert(kpiTargets).values({
            producerUserId: producer.id,
            scopeType: "producer",
            year: 2026,
          }),
        );
        await expectDatabaseError("23514", () =>
          database.insert(kpiTargets).values({
            producerUserId: producer.id,
            scopeType: "company",
            year: 2027,
          }),
        );
        await expectDatabaseError("23514", () =>
          database.insert(kpiTargets).values({
            scopeType: "producer",
            year: 2027,
          }),
        );
        await expectDatabaseError("23503", () =>
          database.insert(kpiTargets).values({
            producerUserId: randomUUID(),
            scopeType: "producer",
            year: 2027,
          }),
        );
        await expectDatabaseError("23514", () =>
          database.insert(kpiTargets).values({
            newPolicyCountTarget: -1,
            scopeType: "company",
            year: 2027,
          }),
        );
        await expectDatabaseError("23514", () =>
          database.insert(kpiTargets).values({
            newRevenueTarget: "-0.01",
            scopeType: "company",
            year: 2027,
          }),
        );
        await expectDatabaseError("23514", () =>
          database.insert(kpiTargets).values({
            retentionRateTarget: "100.01",
            scopeType: "company",
            year: 2027,
          }),
        );
        await expectDatabaseError("23514", () =>
          database.insert(kpiTargets).values({
            scopeType: "company",
            year: 1999,
          }),
        );

        const actualColumns = await pool.query<{ column_name: string }>(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'kpi_targets'
            AND column_name ILIKE '%actual%'
        `);
        assert.deepEqual(actualColumns.rows, []);
      } finally {
        await pool.end();
      }
    },
  );
});

test("KPI target backout is guarded and dependency-safe", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for KPI target DB test");
  const backoutSql = readFileSync(
    resolve(process.cwd(), "drizzle/backout/0032_kpi_targets.sql"),
    "utf8",
  );

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_stone69_down",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 1 });

      try {
        await pool.query(`
          INSERT INTO kpi_targets (scope_type, year)
          VALUES ('company', 2026)
        `);
        await assert.rejects(
          pool.query(backoutSql),
          (error: unknown) => readDatabaseErrorCode(error) === "P0001",
        );
        const guarded = await pool.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM kpi_targets",
        );
        assert.equal(guarded.rows[0]?.count, "1");

        await pool.query("DELETE FROM kpi_targets");
        await pool.query(backoutSql);
        const objects = await pool.query<{
          kpi_table: string | null;
          scope_type_count: string;
          staff_table: string | null;
        }>(`
          SELECT
            to_regclass('public.kpi_targets')::text AS kpi_table,
            (
              SELECT count(*)::text
              FROM pg_type
              WHERE typname = 'kpi_target_scope_type'
            ) AS scope_type_count,
            to_regclass('public.staff_profiles')::text AS staff_table
        `);
        assert.equal(objects.rows[0]?.kpi_table, null);
        assert.equal(objects.rows[0]?.scope_type_count, "0");
        assert.equal(objects.rows[0]?.staff_table, "staff_profiles");
      } finally {
        await pool.end();
      }
    },
  );
});
