import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createUser } from "../auth/users.js";
import { readDatabaseErrorCode } from "./error-code.js";
import * as databaseSchema from "./schema.js";
import { drafts, staffProfiles } from "./schema.js";

interface TransitionInput {
  at: string;
  draftId: string;
  expected: string;
  flagReason?: string | null;
  linkedPolicyId?: string | null;
  linkedQueueEntryId?: string | null;
  next: string;
  sentBackByUserId?: string | null;
  sentBackReason?: string | null;
}

async function transition(
  client: pg.PoolClient,
  input: TransitionInput,
): Promise<void> {
  await client.query(
    `select transition_draft_status(
       $1::uuid,
       $2::draft_status,
       $3::draft_status,
       $4::timestamp with time zone,
       $5::text,
       $6::text,
       $7::uuid,
       $8::uuid,
       $9::uuid
     )`,
    [
      input.draftId,
      input.expected,
      input.next,
      input.at,
      input.flagReason ?? null,
      input.sentBackReason ?? null,
      input.sentBackByUserId ?? null,
      input.linkedQueueEntryId ?? null,
      input.linkedPolicyId ?? null,
    ],
  );
}

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

test("draft integrity enforces ownership, transitions, and terminal state", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(
    databaseUrl,
    "DATABASE_URL is required for the draft integrity smoke test",
  );

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const database = drizzle(client, { schema: databaseSchema });

  try {
    await client.query("BEGIN");

    const owner = await createUser(database, {
      displayName: "Draft Owner",
      email: `draft-integrity-owner-${randomUUID()}@example.test`,
      password: "StrongPass123!",
    });
    const other = await createUser(database, {
      displayName: "Other Employee",
      email: `draft-integrity-other-${randomUUID()}@example.test`,
      password: "StrongPass123!",
    });
    await database.insert(staffProfiles).values([
      { role: "employee", userId: owner.id },
      { role: "employee", userId: other.id },
    ]);

    const [draft] = await database
      .insert(drafts)
      .values({
        amountPaid: "300.00",
        basePremium: "1000.00",
        createdAt: new Date("2026-01-01T12:00:00.000Z"),
        lastEditedAt: new Date("2026-01-01T12:00:00.000Z"),
        ownerUserId: owner.id,
      })
      .returning();
    assert.ok(draft);

    await expectDatabaseError(client, "55000", () =>
      database
        .update(drafts)
        .set({ ownerUserId: other.id })
        .where(eq(drafts.id, draft.id)),
    );
    await expectDatabaseError(client, "55000", () =>
      database
        .update(drafts)
        .set({ status: "submitted" })
        .where(eq(drafts.id, draft.id)),
    );
    await expectDatabaseError(client, "23514", () =>
      database.insert(drafts).values({
        linkedPolicyId: randomUUID(),
        ownerUserId: owner.id,
        status: "approved",
      }),
    );

    const firstQueueId = randomUUID();
    await transition(client, {
      at: "2026-02-01T12:00:00.000Z",
      draftId: draft.id,
      expected: "draft",
      linkedQueueEntryId: firstQueueId,
      next: "submitted",
    });
    await expectDatabaseError(client, "40001", () =>
      transition(client, {
        at: "2026-02-02T12:00:00.000Z",
        draftId: draft.id,
        expected: "draft",
        flagReason: "Stale writer",
        next: "flagged",
      }),
    );
    await expectDatabaseError(client, "55000", () =>
      database
        .update(drafts)
        .set({ amountPaid: "999.00" })
        .where(eq(drafts.id, draft.id)),
    );
    await expectDatabaseError(client, "23514", () =>
      transition(client, {
        at: "2026-02-03T12:00:00.000Z",
        draftId: draft.id,
        expected: "submitted",
        flagReason: "Invalid path",
        next: "flagged",
      }),
    );

    await transition(client, {
      at: "2026-03-01T12:00:00.000Z",
      draftId: draft.id,
      expected: "submitted",
      next: "draft",
    });
    await expectDatabaseError(client, "23514", () =>
      transition(client, {
        at: "2026-03-02T12:00:00.000Z",
        draftId: draft.id,
        expected: "draft",
        flagReason: "   ",
        next: "flagged",
      }),
    );
    await transition(client, {
      at: "2026-03-03T12:00:00.000Z",
      draftId: draft.id,
      expected: "draft",
      flagReason: "Needs admin help",
      next: "flagged",
    });
    await transition(client, {
      at: "2026-03-04T12:00:00.000Z",
      draftId: draft.id,
      expected: "flagged",
      next: "sent_back",
      sentBackByUserId: other.id,
      sentBackReason: "Please correct the carrier",
    });
    await expectDatabaseError(client, "23514", () =>
      transition(client, {
        at: "2026-03-05T12:00:00.000Z",
        draftId: draft.id,
        expected: "sent_back",
        linkedPolicyId: randomUUID(),
        next: "approved",
      }),
    );
    await transition(client, {
      at: "2026-03-06T12:00:00.000Z",
      draftId: draft.id,
      expected: "sent_back",
      next: "draft",
    });

    const secondQueueId = randomUUID();
    await transition(client, {
      at: "2026-04-01T12:00:00.000Z",
      draftId: draft.id,
      expected: "draft",
      linkedQueueEntryId: secondQueueId,
      next: "submitted",
    });
    const policyId = randomUUID();
    await transition(client, {
      at: "2026-04-02T12:00:00.000Z",
      draftId: draft.id,
      expected: "submitted",
      linkedPolicyId: policyId,
      next: "approved",
    });

    const [approved] = await database
      .select()
      .from(drafts)
      .where(eq(drafts.id, draft.id));
    assert.equal(approved?.ownerUserId, owner.id);
    assert.equal(approved?.status, "approved");
    assert.equal(approved?.amountPaid, "300.00");
    assert.equal(approved?.linkedQueueEntryId, secondQueueId);
    assert.equal(approved?.linkedPolicyId, policyId);
    assert.equal(approved?.sentBackByUserId, other.id);

    await expectDatabaseError(client, "55000", () =>
      database
        .update(drafts)
        .set({ notes: "Must not change" })
        .where(eq(drafts.id, draft.id)),
    );
    await expectDatabaseError(client, "55000", () =>
      database.delete(drafts).where(eq(drafts.id, draft.id)),
    );
    await expectDatabaseError(client, "55000", () =>
      transition(client, {
        at: "2026-04-03T12:00:00.000Z",
        draftId: draft.id,
        expected: "approved",
        next: "draft",
      }),
    );
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
