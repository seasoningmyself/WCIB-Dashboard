import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { hashPassword } from "../auth/password.js";
import { readDatabaseErrorCode } from "./error-code.js";
import {
  carriers,
  drafts,
  mgas,
  officeLocations,
  policyTypes,
  staffProfiles,
  users,
} from "./schema.js";
import * as databaseSchema from "./schema.js";

test("drafts persist UUID-owned v15 turn-in and financing fields", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for the drafts smoke test");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const database = drizzle(pool, { schema: databaseSchema });
  const runId = randomUUID();
  const userIds: string[] = [];
  const draftIds: string[] = [];

  try {
    const passwordHash = await hashPassword("DraftTestPassword1!");
    const [owner] = await database
      .insert(users)
      .values({
        displayName: `Draft owner ${runId}`,
        email: `draft-owner-${runId}@example.test`,
        passwordHash,
      })
      .returning({ id: users.id });
    const [producer] = await database
      .insert(users)
      .values({
        displayName: `Producer ${runId}`,
        email: `draft-producer-${runId}@example.test`,
        passwordHash,
      })
      .returning({ id: users.id });
    assert.ok(owner && producer);
    userIds.push(owner.id, producer.id);

    await database.insert(staffProfiles).values({
      role: "producer",
      userId: producer.id,
    });

    const [carrier] = await database
      .insert(carriers)
      .values({ name: `Carrier ${runId}` })
      .returning({ id: carriers.id });
    const [mga] = await database
      .insert(mgas)
      .values({ name: `MGA ${runId}` })
      .returning({ id: mgas.id });
    const [office] = await database
      .insert(officeLocations)
      .values({ name: `Office ${runId}` })
      .returning({ id: officeLocations.id });
    const [policyType] = await database
      .insert(policyTypes)
      .values({ classTag: "Commercial", name: `Policy Type ${runId}` })
      .returning({ id: policyTypes.id });
    assert.ok(carrier && mga && office && policyType);

    const pushedAt = new Date();
    const [wonBack] = await database
      .insert(drafts)
      .values({
        accountAssignment: "house",
        amountPaid: "300.00",
        basePremium: "1000.00",
        brokerFee: "50.00",
        carrierId: carrier.id,
        commissionConfirmed: true,
        commissionMode: "pct",
        commissionRate: "12.5000",
        companyName: "Example Company",
        depositOption: "300.00",
        effectiveDate: "2026-07-01",
        expirationDate: "2027-07-01",
        financeBalance: "780.00",
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
        history: [
          { action: "created", at: "2026-07-01T12:00:00.000Z", by: owner.id },
        ],
        insuredName: "Example Insured",
        invoiceNumber: "INV-TEST",
        ipfsFinanced: "yes",
        ipfsManual: false,
        ipfsPushed: true,
        ipfsPushedAt: pushedAt,
        ipfsReturning: "returning",
        mgaFee: "25.00",
        mgaId: mga.id,
        netDue: "125.00",
        notes: "Draft notes",
        officeLocationId: office.id,
        ownerUserId: owner.id,
        paymentMode: "deposit",
        policyNumber: "POL-WON-BACK",
        policyTypeId: policyType.id,
        producerUserId: producer.id,
        proposalTotal: "1080.00",
        taxes: "5.00",
        transactionNotes: "Client returned after a coverage gap",
        transactionType: "Won Back",
      })
      .returning();
    assert.ok(wonBack);
    draftIds.push(wonBack.id);

    const [rewrite] = await database
      .insert(drafts)
      .values({
        ownerUserId: owner.id,
        transactionNotes: "Moved to a different carrier for coverage",
        transactionType: "Rewrite",
      })
      .returning();
    assert.ok(rewrite);
    draftIds.push(rewrite.id);

    assert.equal(wonBack.ownerUserId, owner.id);
    assert.equal(wonBack.producerUserId, producer.id);
    assert.equal(wonBack.transactionType, "Won Back");
    assert.equal(rewrite.transactionType, "Rewrite");
    assert.equal(wonBack.financeBalance, "780.00");
    assert.equal(wonBack.commissionRate, "12.5000");
    assert.deepEqual(wonBack.financeMeta, {
      billingType: "invoice",
      loanType: "commercial",
      minEarnedAmt: null,
      minEarnedPct: null,
    });
    assert.equal(wonBack.ipfsPushedAt?.getTime(), pushedAt.getTime());

    const forbiddenColumns = await database.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns
          where table_schema = 'public'
            and table_name = 'drafts'
            and column_name in (
              'rewrite_subtype',
              'carrier_fee',
              'balance_due_from_insured',
              'remaining_net_due'
            )`,
    );
    assert.deepEqual(forbiddenColumns.rows, []);

    await assert.rejects(
      database.insert(drafts).values({ ownerUserId: randomUUID() }),
      (error: unknown) => readDatabaseErrorCode(error) === "23503",
    );
    await assert.rejects(
      database.insert(drafts).values({
        basePremium: "-0.01",
        ownerUserId: owner.id,
      }),
      (error: unknown) => readDatabaseErrorCode(error) === "23514",
    );
    await assert.rejects(
      database.insert(drafts).values({
        history: Array.from({ length: 201 }, (_, index) => ({ index })),
        ownerUserId: owner.id,
      }),
      (error: unknown) => readDatabaseErrorCode(error) === "23514",
    );
  } finally {
    if (draftIds.length > 0) {
      await database.delete(drafts).where(inArray(drafts.id, draftIds));
    }
    await database
      .delete(policyTypes)
      .where(eq(policyTypes.name, `Policy Type ${runId}`));
    await database.delete(mgas).where(eq(mgas.name, `MGA ${runId}`));
    await database.delete(carriers).where(eq(carriers.name, `Carrier ${runId}`));
    await database
      .delete(officeLocations)
      .where(eq(officeLocations.name, `Office ${runId}`));
    if (userIds.length > 0) {
      await database
        .delete(staffProfiles)
        .where(inArray(staffProfiles.userId, userIds));
    }
    if (userIds.length > 0) {
      await database.delete(users).where(inArray(users.id, userIds));
    }
    await pool.end();
  }
});
