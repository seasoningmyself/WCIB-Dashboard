import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { readDatabaseErrorCode } from "./error-code.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "./policy-test-fixture.js";
import {
  carriers,
  drafts,
  mgas,
  officeLocations,
  policies,
  policyTypes,
  staffProfiles,
  users,
} from "./schema.js";
import * as databaseSchema from "./schema.js";

async function expectForeignKeyFailure(
  client: pg.PoolClient,
  action: () => Promise<unknown>,
  expectedCode = "23503",
): Promise<void> {
  await client.query("SAVEPOINT expected_policy_fk_error");
  try {
    await assert.rejects(
      action,
      (error: unknown) => readDatabaseErrorCode(error) === expectedCode,
    );
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT expected_policy_fk_error");
    await client.query("RELEASE SAVEPOINT expected_policy_fk_error");
  }
}

test("policies reject orphan identities and preserve deactivated history", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for policy FK test");

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const database = drizzle(client, { schema: databaseSchema });

  try {
    await client.query("BEGIN");
    const references = await createPolicyReferenceFixture(database);
    const [policy] = await database
      .insert(policies)
      .values(
        policyTestInput(references, {
          insuredName: "Referential Integrity Insured",
          kayleeSplit: "book",
          producerUserId: references.producerUserId,
        }),
      )
      .returning();
    assert.ok(policy);

    for (const invalidReference of [
      { sourceDraftId: randomUUID() },
      { submittedByUserId: randomUUID() },
      { policyTypeId: randomUUID() },
      { carrierId: randomUUID() },
      { mgaId: randomUUID() },
      { officeLocationId: randomUUID() },
      { kayleeSplit: "book" as const, producerUserId: randomUUID() },
    ]) {
      await expectForeignKeyFailure(client, () =>
        database
          .insert(policies)
          .values(policyTestInput(references, invalidReference)),
      );
    }

    await expectForeignKeyFailure(client, () =>
      database
        .delete(carriers)
        .where(eq(carriers.id, references.carrierId)),
      "23001",
    );
    await expectForeignKeyFailure(client, () =>
      database.delete(mgas).where(eq(mgas.id, references.mgaId)),
      "23001",
    );
    await expectForeignKeyFailure(client, () =>
      database
        .delete(policyTypes)
        .where(eq(policyTypes.id, references.policyTypeId)),
      "23001",
    );
    await expectForeignKeyFailure(client, () =>
      database
        .delete(officeLocations)
        .where(eq(officeLocations.id, references.officeLocationId)),
      "23001",
    );
    await expectForeignKeyFailure(client, () =>
      database
        .delete(staffProfiles)
        .where(eq(staffProfiles.userId, references.producerUserId)),
      "23001",
    );
    await expectForeignKeyFailure(client, () =>
      database.delete(drafts).where(eq(drafts.id, references.sourceDraftId)),
      "23001",
    );
    await expectForeignKeyFailure(client, () =>
      database
        .delete(users)
        .where(eq(users.id, references.submittedByUserId)),
      "23001",
    );

    await database
      .update(carriers)
      .set({ isActive: false })
      .where(eq(carriers.id, references.carrierId));
    await database
      .update(mgas)
      .set({ isActive: false })
      .where(eq(mgas.id, references.mgaId));
    await database
      .update(policyTypes)
      .set({ isActive: false })
      .where(eq(policyTypes.id, references.policyTypeId));
    await database
      .update(officeLocations)
      .set({ isActive: false })
      .where(eq(officeLocations.id, references.officeLocationId));
    await database
      .update(staffProfiles)
      .set({ isActive: false })
      .where(eq(staffProfiles.userId, references.producerUserId));

    const [preserved] = await database
      .select({ id: policies.id, producerUserId: policies.producerUserId })
      .from(policies)
      .where(eq(policies.id, policy.id));
    assert.deepEqual(preserved, {
      id: policy.id,
      producerUserId: references.producerUserId,
    });
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
