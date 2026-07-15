import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { createUser } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import { closePaySheetWithCascade } from "../pay-sheets/close.js";
import { syncMgaPaymentSheetPlacement } from "../pay-sheets/mga-placement.js";
import { setMgaPaymentState } from "../policies/mga-payments.js";
import { captureSchemaFingerprint } from "./migration-safety.js";
import { loadMigrationPlan } from "./migration-plan.js";
import { withDisposableMigratedDatabase } from "./disposable-database-test-helper.js";
import { readDatabaseErrorCode } from "./error-code.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
  type PolicyReferenceFixture,
} from "./policy-test-fixture.js";
import {
  auditEvents,
  paySheetPolicies,
  paySheets,
  policies,
  producerRateHistory,
  staffProfiles,
  userCapabilities,
} from "./schema.js";
import * as databaseSchema from "./schema.js";

const logger: AppLogger = { error() {}, info() {}, warn() {} };

test("Sophia cascade closes every content-bearing producer chain and is idempotent", async () => {
  await withCascadeDatabase("wcib_k2_cascade", async ({ database, fixture }) => {
    const result = await closePaySheetWithCascade(
      database,
      fixture.context,
      fixture.sophiaSheetId,
      true,
      logger,
    );

    assert.equal(result.primary.closed, true);
    assert.equal(result.primary.ownerType, "sophia");
    assert.equal(result.cascaded.length, 2);
    assert.deepEqual(
      result.cascaded.map(({ paySheetId }) => paySheetId).sort(),
      [...fixture.producerSheetIds].sort(),
    );

    const allSheets = await database.select().from(paySheets);
    const closed = allSheets.filter(({ status }) => status === "closed");
    const open = allSheets.filter(({ status }) => status === "open");
    assert.equal(closed.length, 3);
    assert.equal(open.length, 3);
    assert.deepEqual(
      open
        .map(({ ownerType, periodMonth }) => `${ownerType}:${periodMonth}`)
        .sort(),
      ["producer:8", "producer:8", "sophia:8"],
    );

    const snapshots = await database.select().from(paySheetPolicies);
    assert.equal(snapshots.length, 4);
    assert.equal(
      snapshots.every(({ frozenPolicySnapshot }) => frozenPolicySnapshot !== null),
      true,
    );
    assert.equal(
      snapshots.filter(({ frozenRateSnapshot }) => frozenRateSnapshot !== null).length,
      2,
    );
    assert.equal(
      (await closeAudits(database, fixture.allInitialSheetIds)).length,
      3,
    );

    const repeated = await closePaySheetWithCascade(
      database,
      fixture.context,
      fixture.sophiaSheetId,
      true,
      logger,
    );
    assert.equal(repeated.primary.closed, false);
    assert.deepEqual(repeated.cascaded, []);
    assert.equal((await database.select().from(paySheets)).length, 6);
    assert.equal(
      (await closeAudits(database, fixture.allInitialSheetIds)).length,
      3,
    );
  });
});

test("House-only opt-out and producer close retain their v15 boundaries", async () => {
  await withCascadeDatabase("wcib_k2_optout", async ({ database, fixture }) => {
    const houseOnly = await closePaySheetWithCascade(
      database,
      fixture.context,
      fixture.sophiaSheetId,
      false,
      logger,
    );
    assert.equal(houseOnly.primary.closed, true);
    assert.deepEqual(houseOnly.cascaded, []);

    const producerAfterHouse = await database
      .select({ id: paySheets.id, periodMonth: paySheets.periodMonth, status: paySheets.status })
      .from(paySheets)
      .where(inArray(paySheets.id, fixture.producerSheetIds));
    assert.equal(producerAfterHouse.every(({ status }) => status === "open"), true);
    assert.equal(producerAfterHouse.every(({ periodMonth }) => periodMonth === 7), true);

    const [nextPolicy] = await database
      .insert(policies)
      .values(
        cascadePolicyInput(
          fixture.references,
          fixture.producerIds[1]!,
          "K2-optout-next",
          new Date("2026-07-03T12:00:00.000Z"),
        ),
      )
      .returning();
    assert.ok(nextPolicy);
    const nextPaidAt = new Date("2026-07-04T00:00:00.000Z");
    await setMgaPaymentState(
      database,
      fixture.context,
      nextPolicy.id,
      "paid",
      null,
      logger,
      nextPaidAt,
    );
    await syncMgaPaymentSheetPlacement(
      database,
      fixture.context,
      nextPolicy.id,
      true,
      logger,
      nextPaidAt,
    );
    const nextPlacements = await database
      .select({ paySheetId: paySheetPolicies.paySheetId })
      .from(paySheetPolicies)
      .where(eq(paySheetPolicies.policyId, nextPolicy.id));
    const [openSophia] = await database
      .select({ id: paySheets.id, periodMonth: paySheets.periodMonth })
      .from(paySheets)
      .where(and(eq(paySheets.ownerType, "sophia"), eq(paySheets.status, "open")));
    assert.equal(openSophia?.periodMonth, 8);
    assert.deepEqual(
      nextPlacements.map(({ paySheetId }) => paySheetId).sort(),
      [openSophia!.id, fixture.producerSheetIds[1]!].sort(),
    );

    const producerOnly = await closePaySheetWithCascade(
      database,
      fixture.context,
      fixture.producerSheetIds[0]!,
      true,
      logger,
    );
    assert.equal(producerOnly.primary.ownerType, "producer");
    assert.equal(producerOnly.primary.closed, true);
    assert.deepEqual(producerOnly.cascaded, []);

    const [otherProducer] = await database
      .select({ status: paySheets.status })
      .from(paySheets)
      .where(eq(paySheets.id, fixture.producerSheetIds[1]!));
    assert.equal(otherProducer?.status, "open");
  });
});

test("a producer close failure rolls back the entire Sophia cascade", async () => {
  await withCascadeDatabase(
    "wcib_k2_rollback",
    async ({ database, fixture }) => {
      await assert.rejects(
        closePaySheetWithCascade(
          database,
          fixture.context,
          fixture.sophiaSheetId,
          true,
          logger,
        ),
        (error: unknown) => readDatabaseErrorCode(error) === "P0002",
      );

      const sheetsAfter = await database.select().from(paySheets);
      assert.equal(sheetsAfter.length, 3);
      assert.equal(sheetsAfter.every(({ status }) => status === "open"), true);
      assert.equal(sheetsAfter.every(({ frozenTotals }) => frozenTotals === null), true);
      const associations = await database.select().from(paySheetPolicies);
      assert.equal(
        associations.every(
          ({ frozenPolicySnapshot, frozenRateSnapshot }) =>
            frozenPolicySnapshot === null && frozenRateSnapshot === null,
        ),
        true,
      );
      assert.equal(
        (await closeAudits(database, fixture.allInitialSheetIds)).length,
        0,
      );
      const [validRate] = await database.select().from(producerRateHistory);
      assert.equal(validRate?.lockedAt, null);
    },
    { missingRate: true },
  );
});

test("concurrent Sophia cascades serialize to one close set", async () => {
  await withCascadeDatabase(
    "wcib_k2_race",
    async ({ database, fixture, pool }) => {
      await pool.query(`
        CREATE FUNCTION slow_k2_close_for_test()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          PERFORM pg_sleep(0.15);
          RETURN NEW;
        END;
        $$
      `);
      await pool.query(`
        CREATE TRIGGER slow_k2_close_for_test_trigger
        BEFORE UPDATE ON pay_sheet_policies
        FOR EACH ROW
        EXECUTE FUNCTION slow_k2_close_for_test()
      `);

      const first = await pool.connect();
      const second = await pool.connect();
      try {
        const results = await Promise.all([
          closePaySheetWithCascade(
            drizzle(first, { schema: databaseSchema }),
            fixture.context,
            fixture.sophiaSheetId,
            true,
            logger,
          ),
          closePaySheetWithCascade(
            drizzle(second, { schema: databaseSchema }),
            fixture.context,
            fixture.sophiaSheetId,
            true,
            logger,
          ),
        ]);
        assert.deepEqual(
          results.map(({ primary }) => primary.closed).sort(),
          [false, true],
        );
        assert.deepEqual(
          results.map(({ cascaded }) => cascaded.length).sort(),
          [0, 1],
        );
        assert.equal(results[0]?.primary.nextSheetId, results[1]?.primary.nextSheetId);
        assert.equal(
          (await closeAudits(database, fixture.allInitialSheetIds)).length,
          2,
        );
        assert.equal((await database.select().from(paySheets)).length, 4);
      } finally {
        first.release();
        second.release();
        await pool.query(
          "DROP TRIGGER slow_k2_close_for_test_trigger ON pay_sheet_policies",
        );
        await pool.query("DROP FUNCTION slow_k2_close_for_test() ");
      }
    },
    { producerCount: 1 },
  );
});

test("cascade migration rolls back and reapplies byte-identically", async () => {
  const sourceUrl = process.env.DATABASE_URL;
  assert.ok(sourceUrl, "DATABASE_URL is required for migration test");
  await withDisposableMigratedDatabase(
    sourceUrl,
    "wcib_k2_migration",
    async (databaseUrl) => {
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        const plan = loadMigrationPlan();
        const migrationIndex = plan.findIndex(
          ({ tag }) => tag === "0040_pay_sheet_cascade_close",
        );
        assert.notEqual(migrationIndex, -1);
        const replayPlan = plan.slice(migrationIndex);
        const fingerprint = await captureSchemaFingerprint(client);
        assert.equal(await cascadeFunctionExists(client), true);
        for (const migration of [...replayPlan].reverse()) {
          for (const statement of migration.backoutStatements) {
            await client.query(statement);
          }
        }
        assert.equal(await cascadeFunctionExists(client), false);
        assert.notEqual(await captureSchemaFingerprint(client), fingerprint);
        for (const migration of replayPlan) {
          for (const statement of migration.forwardStatements) {
            await client.query(statement);
          }
        }
        assert.equal(await cascadeFunctionExists(client), true);
        assert.equal(await captureSchemaFingerprint(client), fingerprint);
      } finally {
        await client.end();
      }
    },
  );
});

interface FixtureOptions {
  missingRate?: boolean;
  producerCount?: number;
}

async function withCascadeDatabase(
  prefix: string,
  action: (input: {
    database: ReturnType<typeof drizzle<typeof databaseSchema>>;
    fixture: CascadeFixture;
    pool: pg.Pool;
  }) => Promise<void>,
  options: FixtureOptions = {},
): Promise<void> {
  const sourceUrl = process.env.DATABASE_URL;
  assert.ok(sourceUrl, "DATABASE_URL is required for cascade close test");
  await withDisposableMigratedDatabase(sourceUrl, prefix, async (databaseUrl) => {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
    const database = drizzle(pool, { schema: databaseSchema });
    try {
      await action({
        database,
        fixture: await createCascadeFixture(database, options),
        pool,
      });
    } finally {
      await pool.end();
    }
  });
}

interface CascadeFixture {
  allInitialSheetIds: string[];
  context: AuthorizedRequestContext;
  producerIds: string[];
  producerSheetIds: string[];
  references: PolicyReferenceFixture;
  sophiaSheetId: string;
}

async function createCascadeFixture(
  database: ReturnType<typeof drizzle<typeof databaseSchema>>,
  options: FixtureOptions,
): Promise<CascadeFixture> {
  const references = await createPolicyReferenceFixture(database);
  const admin = await createUser(database, {
    email: `k2-admin-${randomUUID()}@example.test`,
    password: "StrongPass123!",
  });
  await database.insert(userCapabilities).values({
    capability: "admin",
    userId: admin.id,
  });

  const producerIds = [references.producerUserId];
  for (let index = 1; index < (options.producerCount ?? 2); index += 1) {
    const producer = await createUser(database, {
      email: `k2-producer-${randomUUID()}@example.test`,
      password: "StrongPass123!",
    });
    await database.insert(staffProfiles).values({
      displayName: `K2 Producer ${index}`,
      role: "producer",
      userId: producer.id,
    });
    producerIds.push(producer.id);
  }
  producerIds.sort();

  const openedAt = new Date("2026-07-01T00:00:00.000Z");
  const [sophiaSheet] = await database
    .insert(paySheets)
    .values({
      createdAt: openedAt,
      openedAt,
      ownerType: "sophia",
      ownerUserId: admin.id,
      periodMonth: 7,
      periodYear: 2026,
      updatedAt: openedAt,
    })
    .returning();
  assert.ok(sophiaSheet);

  const producerSheets = await database
    .insert(paySheets)
    .values(
      producerIds.map((ownerUserId) => ({
        createdAt: openedAt,
        openedAt,
        ownerType: "producer" as const,
        ownerUserId,
        periodMonth: 7,
        periodYear: 2026,
        updatedAt: openedAt,
      })),
    )
    .returning();

  const validProducerIds = options.missingRate
    ? producerIds.slice(0, producerIds.length - 1)
    : producerIds;
  if (validProducerIds.length > 0) {
    await database.insert(producerRateHistory).values(
      validProducerIds.map((producerUserId) => ({
        effectiveDate: "2000-01-01",
        newBrokerRate: "25.00",
        newCommissionRate: "25.00",
        producerUserId,
        renewalBrokerRate: "25.00",
        renewalCommissionRate: "25.00",
      })),
    );
  }

  const createdPolicies = await database
    .insert(policies)
    .values(
      producerIds.map((producerUserId, index) =>
        cascadePolicyInput(
          references,
          producerUserId,
          `K2-${index}`,
          new Date("2026-07-01T12:00:00.000Z"),
        ),
      ),
    )
    .returning();
  const context: AuthorizedRequestContext = {
    principal: {
      capabilities: ["admin"],
      staffRole: null,
      userActive: true,
      userId: admin.id,
    },
  };
  const paidAt = new Date("2026-07-02T00:00:00.000Z");
  for (const policy of createdPolicies) {
    await setMgaPaymentState(
      database,
      context,
      policy.id,
      "paid",
      null,
      logger,
      paidAt,
    );
    await syncMgaPaymentSheetPlacement(
      database,
      context,
      policy.id,
      true,
      logger,
      paidAt,
    );
  }

  const producerSheetIds = producerSheets.map(({ id }) => id);
  return {
    allInitialSheetIds: [sophiaSheet.id, ...producerSheetIds],
    context,
    producerIds,
    producerSheetIds,
    references,
    sophiaSheetId: sophiaSheet.id,
  };
}

function cascadePolicyInput(
  references: PolicyReferenceFixture,
  producerUserId: string,
  prefix: string,
  changedAt: Date,
) {
  return policyTestInput(references, {
    amountPaid: "1000.00",
    basePremium: "1000.00",
    brokerFee: "20.00",
    commissionAmount: "100.00",
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "10.0000",
    createdAt: changedAt,
    kayleeSplit: "book",
    netDue: "880.00",
    policyNumber: `${prefix}-${randomUUID()}`,
    producerUserId,
    proposalTotal: "1020.00",
    sourceDraftId: null,
    updatedAt: changedAt,
  });
}

async function closeAudits(
  database: ReturnType<typeof drizzle<typeof databaseSchema>>,
  sheetIds: readonly string[],
) {
  return database
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.action, "pay_sheet_closed"),
        inArray(auditEvents.entityId, [...sheetIds]),
      ),
    );
}

async function cascadeFunctionExists(client: pg.Client): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(`
    SELECT to_regprocedure(
      'close_pay_sheet_with_cascade(uuid,uuid,boolean)'
    ) IS NOT NULL AS exists
  `);
  return result.rows[0]?.exists ?? false;
}
