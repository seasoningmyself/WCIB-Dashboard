import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  buildPaySheetPolicySnapshot,
  buildPaySheetRateSnapshot,
} from "../pay-sheets/snapshots.js";
import { readDatabaseErrorCode } from "./error-code.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "./policy-test-fixture.js";
import {
  paySheetPolicies,
  paySheets,
  policies,
  producerRateHistory,
} from "./schema.js";
import * as databaseSchema from "./schema.js";

let savepointSequence = 0;

async function expectDatabaseError(
  client: pg.PoolClient,
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  const savepoint = `expected_pay_sheet_policy_error_${savepointSequence++}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await assert.rejects(
      action,
      (error: unknown) => readDatabaseErrorCode(error) === code,
    );
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  }
}

test("pay-sheet policies normalize live links and bounded frozen snapshots", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(
    databaseUrl,
    "DATABASE_URL is required for pay-sheet policy DB test",
  );

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const database = drizzle(client, { schema: databaseSchema });

  try {
    await client.query("BEGIN");
    const references = await createPolicyReferenceFixture(database);
    const sheetCreatedAt = new Date("2026-06-01T12:00:00.000Z");
    const associationCreatedAt = new Date("2026-07-01T12:00:00.000Z");
    const [openSheet, snapshotSheet] = await database
      .insert(paySheets)
      .values([
        {
          createdAt: sheetCreatedAt,
          openedAt: sheetCreatedAt,
          ownerType: "producer",
          ownerUserId: references.producerUserId,
          periodMonth: 6,
          periodYear: 2026,
          updatedAt: sheetCreatedAt,
        },
        {
          createdAt: sheetCreatedAt,
          openedAt: sheetCreatedAt,
          ownerType: "sophia",
          ownerUserId: references.submittedByUserId,
          periodMonth: 5,
          periodYear: 2026,
          updatedAt: sheetCreatedAt,
        },
      ])
      .returning();
    assert.ok(openSheet);
    assert.ok(snapshotSheet);

    // Item 24's table-contract test runs after item 25 in the current schema.
    // This transaction-local context lets the migration owner exercise the
    // underlying constraints without opening the production direct-write path.
    await client.query(
      "select set_config('wcib.pay_sheet_placement_context', 'placement', true)",
    );

    const [rate] = await database
      .insert(producerRateHistory)
      .values({
        effectiveDate: "2026-06-01",
        newBrokerRate: "12.50",
        newCommissionRate: "25.00",
        producerUserId: references.producerUserId,
        renewalBrokerRate: "10.00",
        renewalCommissionRate: "20.00",
      })
      .returning();
    assert.ok(rate);

    const policyValues = {
      amountPaid: "1000.00",
      basePremium: "1000.00",
      brokerFee: "50.00",
      commissionAmount: "100.00",
      commissionConfirmed: true,
      commissionMode: "pct" as const,
      commissionRate: "10.0000",
      financeBalance: "0.00",
      kayleeSplit: "book" as const,
      netDue: "850.00",
      paymentMode: "full" as const,
      producerUserId: references.producerUserId,
      proposalTotal: "1050.00",
      sourceDraftId: null,
    };
    const [openPolicy, frozenPolicy] = await database
      .insert(policies)
      .values([
        policyTestInput(references, {
          ...policyValues,
          policyNumber: "PAY-SHEET-OPEN",
        }),
        policyTestInput(references, {
          ...policyValues,
          policyNumber: "PAY-SHEET-FROZEN",
        }),
      ])
      .returning();
    assert.ok(openPolicy);
    assert.ok(frozenPolicy);

    const [openAssociation] = await database
      .insert(paySheetPolicies)
      .values({
        addedAt: associationCreatedAt,
        createdAt: associationCreatedAt,
        paySheetId: openSheet.id,
        policyId: openPolicy.id,
      })
      .returning();
    assert.ok(openAssociation);
    assert.match(openAssociation.id, /^[0-9a-f-]{36}$/);
    assert.equal(openAssociation.frozenPolicySnapshot, null);
    assert.equal(openAssociation.producerRateHistoryId, null);
    assert.equal(openAssociation.frozenRateSnapshot, null);

    await expectDatabaseError(client, "23505", () =>
      database.insert(paySheetPolicies).values({
        paySheetId: openSheet.id,
        policyId: openPolicy.id,
      }),
    );

    const policySnapshot = buildPaySheetPolicySnapshot({
      approvedAt: frozenPolicy.approvedAt,
      brokerFee: frozenPolicy.brokerFee,
      carrierFee: "must-not-copy",
      commissionAmount: frozenPolicy.commissionAmount,
      effectiveDate: frozenPolicy.effectiveDate,
      insuredName: frozenPolicy.insuredName,
      kayleeSplit: frozenPolicy.kayleeSplit,
      officeLocationId: frozenPolicy.officeLocationId,
      policyId: frozenPolicy.id,
      policyNumber: frozenPolicy.policyNumber,
      policyTypeClass: "Commercial",
      policyTypeName: "General Liability",
      producerPayout: "37.50",
      producerUserId: frozenPolicy.producerUserId,
      sophiaShare: "112.50",
      transactionType: "Won Back",
    });
    const rateSnapshot = buildPaySheetRateSnapshot(rate);
    const [frozenAssociation] = await database
      .insert(paySheetPolicies)
      .values({
        addedAt: associationCreatedAt,
        createdAt: associationCreatedAt,
        frozenPolicySnapshot: policySnapshot,
        frozenRateSnapshot: rateSnapshot,
        paySheetId: snapshotSheet.id,
        policyId: frozenPolicy.id,
        producerRateHistoryId: rate.id,
      })
      .returning();
    assert.ok(frozenAssociation);
    assert.deepEqual(frozenAssociation.frozenPolicySnapshot, policySnapshot);
    assert.deepEqual(frozenAssociation.frozenRateSnapshot, rateSnapshot);
    assert.equal(
      "carrierFee" in
        (frozenAssociation.frozenPolicySnapshot as Record<string, unknown>),
      false,
    );

    for (const invalidSnapshot of [
      { ...policySnapshot, carrierFee: "1.00" },
      { ...policySnapshot, commissionAmount: 100 },
      { policyId: frozenPolicy.id },
    ]) {
      await expectDatabaseError(client, "23514", () =>
        database.insert(paySheetPolicies).values({
          frozenPolicySnapshot: invalidSnapshot,
          paySheetId: snapshotSheet.id,
          policyId: openPolicy.id,
        }),
      );
    }
    await expectDatabaseError(client, "23514", () =>
      database.insert(paySheetPolicies).values({
        paySheetId: snapshotSheet.id,
        policyId: openPolicy.id,
        producerRateHistoryId: rate.id,
      }),
    );
    await expectDatabaseError(client, "23514", () =>
      database.insert(paySheetPolicies).values({
        frozenRateSnapshot: rateSnapshot,
        paySheetId: snapshotSheet.id,
        policyId: openPolicy.id,
      }),
    );
    await expectDatabaseError(client, "23514", () =>
      database.insert(paySheetPolicies).values({
        frozenRateSnapshot: { ...rateSnapshot, carrierFee: "1.00" },
        paySheetId: snapshotSheet.id,
        policyId: openPolicy.id,
        producerRateHistoryId: rate.id,
      }),
    );
    await expectDatabaseError(client, "23503", () =>
      database.insert(paySheetPolicies).values({
        paySheetId: randomUUID(),
        policyId: openPolicy.id,
      }),
    );
    await expectDatabaseError(client, "23503", () =>
      database.insert(paySheetPolicies).values({
        paySheetId: openSheet.id,
        policyId: randomUUID(),
      }),
    );
    await expectDatabaseError(client, "23503", () =>
      database.insert(paySheetPolicies).values({
        frozenRateSnapshot: rateSnapshot,
        paySheetId: snapshotSheet.id,
        policyId: openPolicy.id,
        producerRateHistoryId: randomUUID(),
      }),
    );
    await expectDatabaseError(client, "23514", () =>
      database.insert(paySheetPolicies).values({
        addedAt: new Date("2026-06-30T12:00:00.000Z"),
        createdAt: associationCreatedAt,
        paySheetId: snapshotSheet.id,
        policyId: openPolicy.id,
      }),
    );

    await expectDatabaseError(client, "23001", () =>
      database.delete(paySheets).where(eq(paySheets.id, snapshotSheet.id)),
    );
    await expectDatabaseError(client, "23001", () =>
      database.delete(policies).where(eq(policies.id, frozenPolicy.id)),
    );
    await expectDatabaseError(client, "55000", () =>
      database
        .delete(producerRateHistory)
        .where(eq(producerRateHistory.id, rate.id)),
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
