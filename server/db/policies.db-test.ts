import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { readDatabaseErrorCode } from "./error-code.js";
import { createPolicyReferenceFixture } from "./policy-test-fixture.js";
import { policies } from "./schema.js";
import * as databaseSchema from "./schema.js";

async function expectDatabaseError(
  client: pg.PoolClient,
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  await client.query("SAVEPOINT expected_policy_error");
  try {
    await assert.rejects(
      action,
      (error: unknown) => readDatabaseErrorCode(error) === code,
    );
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT expected_policy_error");
    await client.query("RELEASE SAVEPOINT expected_policy_error");
  }
}

test("policies persist exact v15 ledger, split, and financing facts", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for the policies smoke test");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const database = drizzle(client, { schema: databaseSchema });

  try {
    await client.query("BEGIN");
    const references = await createPolicyReferenceFixture(database);
    const submittedAt = new Date("2026-07-01T12:00:00.000Z");
    const approvedAt = new Date("2026-07-01T13:00:00.000Z");
    const pushedAt = new Date("2026-07-02T12:00:00.000Z");
    const producerUserId = references.producerUserId;
    const [wonBack] = await database
      .insert(policies)
      .values({
        accountAssignment: "house",
        amountPaid: "350.00",
        approvedAt,
        basePremium: "1000.00",
        brokerFee: "50.00",
        carrierId: references.carrierId,
        commissionAmount: "125.00",
        commissionConfirmed: true,
        commissionMode: "pct",
        commissionRate: "12.5000",
        companyName: "Example Company",
        createdAt: approvedAt,
        depositOption: "350.00",
        effectiveDate: "2026-07-01",
        expirationDate: "2027-07-01",
        financeBalance: "775.00",
        financeContact: {
          address: "123 Example Street",
          email: "finance@example.test",
          mobile: "555-0100",
        },
        financeMeta: {
          billingType: "invoice",
          loanType: "commercial",
          minEarnedAmt: null,
          minEarnedPct: null,
        },
        financeReference: "IPFS-TEST",
        insuredName: "Example Insured",
        ipfsFinanced: "yes",
        ipfsManual: false,
        ipfsPushed: true,
        ipfsPushedAt: pushedAt,
        ipfsReturning: "new",
        kayleeSplit: "book",
        mgaFee: "25.00",
        mgaId: references.mgaId,
        netDue: "175.00",
        notes: "Policy notes",
        officeLocationId: references.officeLocationId,
        paymentMode: "deposit",
        policyNumber: "POL-WON-BACK",
        policyTypeId: references.policyTypeId,
        producerUserId,
        proposalTotal: "1125.00",
        sourceDraftId: references.sourceDraftId,
        submittedAt,
        submittedByUserId: references.submittedByUserId,
        taxes: "50.00",
        transactionNotes: "Client returned after a coverage gap",
        transactionType: "Won Back",
        updatedAt: approvedAt,
      })
      .returning();
    assert.ok(wonBack);

    const [rewrite] = await database
      .insert(policies)
      .values({
        accountAssignment: "none",
        amountPaid: "100.00",
        approvedAt,
        basePremium: "0.00",
        brokerFee: "100.00",
        carrierId: references.carrierId,
        commissionAmount: "0.00",
        commissionConfirmed: false,
        commissionMode: "na",
        effectiveDate: "2026-07-01",
        expirationDate: "2027-07-01",
        financeBalance: "0.00",
        insuredName: "Rewrite Insured",
        kayleeSplit: "none",
        mgaId: references.mgaId,
        netDue: "0.00",
        officeLocationId: references.officeLocationId,
        paymentMode: "full",
        policyNumber: "POL-REWRITE",
        policyTypeId: references.policyTypeId,
        proposalTotal: "100.00",
        submittedAt,
        submittedByUserId: references.submittedByUserId,
        transactionNotes: "Moved carrier for a coverage need",
        transactionType: "Rewrite",
      })
      .returning();
    assert.ok(rewrite);

    assert.equal(wonBack.kayleeSplit, "book");
    assert.equal(wonBack.producerUserId, producerUserId);
    assert.equal(wonBack.transactionType, "Won Back");
    assert.equal(rewrite.transactionType, "Rewrite");
    assert.equal(wonBack.commissionAmount, "125.00");
    assert.equal(wonBack.financeBalance, "775.00");
    assert.equal(wonBack.ipfsPushedAt?.toISOString(), pushedAt.toISOString());
    assert.deepEqual(wonBack.financeMeta, {
      billingType: "invoice",
      loanType: "commercial",
      minEarnedAmt: null,
      minEarnedPct: null,
    });

    const forbiddenColumns = await database.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns
          where table_schema = 'public'
            and table_name = 'policies'
            and column_name in (
              'rewrite_subtype',
              'carrier_fee',
              'on_pay_sheets',
              'balance_due_from_insured',
              'remaining_net_due'
            )`,
    );
    assert.deepEqual(forbiddenColumns.rows, []);

    await expectDatabaseError(client, "23514", () =>
      database.insert(policies).values({
        accountAssignment: "book",
        amountPaid: "350.00",
        approvedAt,
        basePremium: "1000.00",
        brokerFee: "50.00",
        carrierId: references.carrierId,
        commissionAmount: "125.00",
        commissionConfirmed: true,
        commissionMode: "pct",
        commissionRate: "12.5000",
        effectiveDate: "2026-07-01",
        expirationDate: "2027-07-01",
        financeBalance: "0.00",
        insuredName: "Missing Producer",
        kayleeSplit: "book",
        mgaId: references.mgaId,
        netDue: "175.00",
        officeLocationId: references.officeLocationId,
        paymentMode: "full",
        policyNumber: "INVALID-SPLIT",
        policyTypeId: references.policyTypeId,
        proposalTotal: "1050.00",
        submittedAt,
        submittedByUserId: references.submittedByUserId,
        transactionType: "New",
      }),
    );
    await expectDatabaseError(client, "23514", () =>
      database.insert(policies).values({
        accountAssignment: "none",
        amountPaid: "100.00",
        approvedAt,
        basePremium: "0.00",
        brokerFee: "100.00",
        carrierId: references.carrierId,
        commissionAmount: "0.00",
        commissionMode: "na",
        effectiveDate: "2026-07-01",
        expirationDate: "2027-07-01",
        insuredName: "Wrong Total",
        kayleeSplit: "none",
        mgaId: references.mgaId,
        netDue: "0.00",
        officeLocationId: references.officeLocationId,
        paymentMode: "full",
        policyNumber: "INVALID-TOTAL",
        policyTypeId: references.policyTypeId,
        proposalTotal: "101.00",
        submittedAt,
        submittedByUserId: references.submittedByUserId,
        transactionType: "New",
      }),
    );
    await expectDatabaseError(client, "22P02", () =>
      database.execute(
        sql`insert into policies (
          submitted_by_user_id, insured_name, policy_number, policy_type_id,
          transaction_type, effective_date, expiration_date, carrier_id, mga_id,
          office_location_id, kaylee_split, broker_fee, commission_amount,
          commission_mode, amount_paid, proposal_total, net_due, payment_mode,
          submitted_at, approved_at
        ) values (
          ${references.submittedByUserId}::uuid, 'Invalid Split', 'INVALID-ENUM', ${references.policyTypeId}::uuid,
          'New', '2026-07-01', '2027-07-01', ${references.carrierId}::uuid, ${references.mgaId}::uuid,
          ${references.officeLocationId}::uuid, 'other', 0, 0, 'na', 0, 0, 0, 'full', now(), now()
        )`,
      ),
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
