import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createUser } from "../auth/users.js";
import { readDatabaseErrorCode } from "./error-code.js";
import {
  approvalQueueEntries,
  drafts,
  staffProfiles,
} from "./schema.js";
import * as databaseSchema from "./schema.js";

async function expectDatabaseError(
  client: pg.PoolClient,
  code: string,
  action: () => Promise<unknown>,
): Promise<void> {
  await client.query("SAVEPOINT expected_database_error");
  try {
    await assert.rejects(
      action,
      (error: unknown) => readDatabaseErrorCode(error) === code,
    );
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT expected_database_error");
    await client.query("RELEASE SAVEPOINT expected_database_error");
  }
}

test("approval queue preserves one immutable submitted snapshot per active draft", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(
    databaseUrl,
    "DATABASE_URL is required for the approval queue smoke test",
  );

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const database = drizzle(client, { schema: databaseSchema });

  try {
    await client.query("BEGIN");

    const submitter = await createUser(database, {
      email: `queue-submitter-${randomUUID()}@example.test`,
      password: "StrongPass123!",
    });
    const admin = await createUser(database, {
      email: `queue-admin-${randomUUID()}@example.test`,
      password: "StrongPass123!",
    });
    await database.insert(staffProfiles).values({
      displayName: "Queue Submitter",
      role: "employee",
      userId: submitter.id,
    });

    const [draft] = await database
      .insert(drafts)
      .values({ ownerUserId: submitter.id })
      .returning({ id: drafts.id });
    const [validationDraft] = await database
      .insert(drafts)
      .values({ ownerUserId: submitter.id })
      .returning({ id: drafts.id });
    assert.ok(draft && validationDraft);

    const payload = {
      basePremium: "1000.00",
      insuredName: "Private Insured",
      schemaVersion: 1,
      transactionType: "Won Back",
    };
    const [entry] = await database
      .insert(approvalQueueEntries)
      .values({
        draftId: draft.id,
        submittedByUserId: submitter.id,
        submittedPayload: payload,
      })
      .returning();
    assert.ok(entry);
    assert.deepEqual(entry.submittedPayload, payload);
    assert.equal(entry.status, "pending");

    await expectDatabaseError(client, "23505", () =>
      database.insert(approvalQueueEntries).values({
        draftId: draft.id,
        submittedByUserId: submitter.id,
        submittedPayload: payload,
      }),
    );
    await expectDatabaseError(client, "55000", () =>
      database
        .update(approvalQueueEntries)
        .set({ submittedPayload: { ...payload, basePremium: "1.00" } })
        .where(eq(approvalQueueEntries.id, entry.id)),
    );
    await expectDatabaseError(client, "23514", () =>
      database
        .update(approvalQueueEntries)
        .set({ status: "sent_back" })
        .where(eq(approvalQueueEntries.id, entry.id)),
    );

    const actedAt = new Date("2026-07-02T12:00:00.000Z");
    await database
      .update(approvalQueueEntries)
      .set({
        actedAt,
        actedByUserId: admin.id,
        reason: "Please correct the carrier",
        status: "sent_back",
      })
      .where(eq(approvalQueueEntries.id, entry.id));

    const [sentBack] = await database
      .select()
      .from(approvalQueueEntries)
      .where(eq(approvalQueueEntries.id, entry.id));
    assert.equal(sentBack?.status, "sent_back");
    assert.deepEqual(sentBack?.submittedPayload, payload);
    assert.equal(sentBack?.actedByUserId, admin.id);
    assert.ok(sentBack && sentBack.updatedAt > entry.updatedAt);

    const [resubmitted] = await database
      .insert(approvalQueueEntries)
      .values({
        draftId: draft.id,
        submittedByUserId: submitter.id,
        submittedPayload: payload,
      })
      .returning();
    assert.ok(resubmitted);

    await database
      .update(approvalQueueEntries)
      .set({
        actedAt: new Date("2026-07-03T12:00:00.000Z"),
        actedByUserId: admin.id,
        reason: "Needs review",
        status: "flagged",
      })
      .where(eq(approvalQueueEntries.id, resubmitted.id));

    await expectDatabaseError(client, "23514", () =>
      database.insert(approvalQueueEntries).values({
        draftId: validationDraft.id,
        submittedByUserId: submitter.id,
        submittedPayload: { insuredName: "Missing version" },
      }),
    );
    await expectDatabaseError(client, "23514", () =>
      database.insert(approvalQueueEntries).values({
        draftId: validationDraft.id,
        submittedByUserId: submitter.id,
        submittedPayload: { carrierFee: "5.00", schemaVersion: 1 },
      }),
    );
    await expectDatabaseError(client, "23503", () =>
      database.insert(approvalQueueEntries).values({
        draftId: randomUUID(),
        submittedByUserId: submitter.id,
        submittedPayload: payload,
      }),
    );
    await expectDatabaseError(client, "23514", () =>
      database.insert(approvalQueueEntries).values({
        actedAt: new Date(),
        actedByUserId: admin.id,
        draftId: validationDraft.id,
        reason: "Cannot start flagged",
        status: "flagged",
        submittedByUserId: submitter.id,
        submittedPayload: payload,
      }),
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
