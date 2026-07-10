import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { KAYLEE_PRODUCER_SHARE_PERCENT } from "../../shared/policy-fields.js";
import { readDatabaseErrorCode } from "./error-code.js";
import { policies } from "./schema.js";
import * as databaseSchema from "./schema.js";

test("policies persist exact v15 ledger, split, and financing facts", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for the policies smoke test");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const database = drizzle(pool, { schema: databaseSchema });
  const policyIds: string[] = [];

  try {
    const submittedAt = new Date("2026-07-01T12:00:00.000Z");
    const approvedAt = new Date("2026-07-01T13:00:00.000Z");
    const pushedAt = new Date("2026-07-02T12:00:00.000Z");
    const producerUserId = randomUUID();
    const [wonBack] = await database
      .insert(policies)
      .values({
        accountAssignment: "house",
        amountPaid: "350.00",
        approvedAt,
        basePremium: "1000.00",
        brokerFee: "50.00",
        carrierId: randomUUID(),
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
        mgaId: randomUUID(),
        netDue: "175.00",
        notes: "Policy notes",
        officeLocationId: randomUUID(),
        paymentMode: "deposit",
        policyNumber: "POL-WON-BACK",
        policyTypeId: randomUUID(),
        producerUserId,
        proposalTotal: "1125.00",
        sourceDraftId: randomUUID(),
        submittedAt,
        submittedByUserId: randomUUID(),
        taxes: "50.00",
        transactionNotes: "Client returned after a coverage gap",
        transactionType: "Won Back",
        updatedAt: approvedAt,
      })
      .returning();
    assert.ok(wonBack);
    policyIds.push(wonBack.id);

    const [rewrite] = await database
      .insert(policies)
      .values({
        accountAssignment: "none",
        amountPaid: "100.00",
        approvedAt,
        basePremium: "0.00",
        brokerFee: "100.00",
        carrierId: randomUUID(),
        commissionAmount: "0.00",
        commissionConfirmed: false,
        commissionMode: "na",
        effectiveDate: "2026-07-01",
        expirationDate: "2027-07-01",
        financeBalance: "0.00",
        insuredName: "Rewrite Insured",
        kayleeSplit: "none",
        mgaId: randomUUID(),
        netDue: "0.00",
        officeLocationId: randomUUID(),
        paymentMode: "full",
        policyNumber: "POL-REWRITE",
        policyTypeId: randomUUID(),
        proposalTotal: "100.00",
        submittedAt,
        submittedByUserId: randomUUID(),
        transactionNotes: "Moved carrier for a coverage need",
        transactionType: "Rewrite",
      })
      .returning();
    assert.ok(rewrite);
    policyIds.push(rewrite.id);

    assert.equal(KAYLEE_PRODUCER_SHARE_PERCENT, 25);
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
              'premium_total',
              'collected_to_date',
              'balance_due_from_insured',
              'remaining_net_due'
            )`,
    );
    assert.deepEqual(forbiddenColumns.rows, []);

    await assert.rejects(
      database.insert(policies).values({
        accountAssignment: "book",
        amountPaid: "350.00",
        approvedAt,
        basePremium: "1000.00",
        brokerFee: "50.00",
        carrierId: randomUUID(),
        commissionAmount: "125.00",
        commissionConfirmed: true,
        commissionMode: "pct",
        commissionRate: "12.5000",
        effectiveDate: "2026-07-01",
        expirationDate: "2027-07-01",
        financeBalance: "0.00",
        insuredName: "Missing Producer",
        kayleeSplit: "book",
        mgaId: randomUUID(),
        netDue: "175.00",
        officeLocationId: randomUUID(),
        paymentMode: "full",
        policyNumber: "INVALID-SPLIT",
        policyTypeId: randomUUID(),
        proposalTotal: "1050.00",
        submittedAt,
        submittedByUserId: randomUUID(),
        transactionType: "New",
      }),
      (error: unknown) => readDatabaseErrorCode(error) === "23514",
    );
    await assert.rejects(
      database.insert(policies).values({
        accountAssignment: "none",
        amountPaid: "100.00",
        approvedAt,
        basePremium: "0.00",
        brokerFee: "100.00",
        carrierId: randomUUID(),
        commissionAmount: "0.00",
        commissionMode: "na",
        effectiveDate: "2026-07-01",
        expirationDate: "2027-07-01",
        insuredName: "Wrong Total",
        kayleeSplit: "none",
        mgaId: randomUUID(),
        netDue: "0.00",
        officeLocationId: randomUUID(),
        paymentMode: "full",
        policyNumber: "INVALID-TOTAL",
        policyTypeId: randomUUID(),
        proposalTotal: "101.00",
        submittedAt,
        submittedByUserId: randomUUID(),
        transactionType: "New",
      }),
      (error: unknown) => readDatabaseErrorCode(error) === "23514",
    );
    await assert.rejects(
      database.execute(
        sql`insert into policies (
          submitted_by_user_id, insured_name, policy_number, policy_type_id,
          transaction_type, effective_date, expiration_date, carrier_id, mga_id,
          office_location_id, kaylee_split, broker_fee, commission_amount,
          commission_mode, amount_paid, proposal_total, net_due, payment_mode,
          submitted_at, approved_at
        ) values (
          ${randomUUID()}::uuid, 'Invalid Split', 'INVALID-ENUM', ${randomUUID()}::uuid,
          'New', '2026-07-01', '2027-07-01', ${randomUUID()}::uuid, ${randomUUID()}::uuid,
          ${randomUUID()}::uuid, 'other', 0, 0, 'na', 0, 0, 0, 'full', now(), now()
        )`,
      ),
      (error: unknown) => readDatabaseErrorCode(error) === "22P02",
    );
  } finally {
    if (policyIds.length > 0) {
      await database.delete(policies).where(inArray(policies.id, policyIds));
    }
    await pool.end();
  }
});
