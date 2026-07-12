import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as databaseSchema from "../db/schema.js";
import {
  carriers,
  mgas,
  officeLocations,
  policyTypes,
} from "../db/schema.js";
import { loadActiveVocabulary } from "./active.js";

test("active vocabulary read is filtered, deterministic, and picker-safe", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(
    databaseUrl,
    "DATABASE_URL is required for the active vocabulary database test",
  );

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  const database = drizzle(pool, { schema: databaseSchema });
  const runId = randomUUID();
  const createdIds = {
    carriers: [] as string[],
    mgas: [] as string[],
    offices: [] as string[],
    policyTypes: [] as string[],
  };

  try {
    const carrierRows = await database
      .insert(carriers)
      .values([
        { name: `STONE-87 ${runId} Zeta Carrier` },
        { name: `STONE-87 ${runId} alpha Carrier` },
        { isActive: false, name: `STONE-87 ${runId} Inactive Carrier` },
      ])
      .returning({ id: carriers.id });
    createdIds.carriers.push(...carrierRows.map(({ id }) => id));

    const mgaRows = await database
      .insert(mgas)
      .values([
        { name: `STONE-87 ${runId} Zeta MGA` },
        { name: `STONE-87 ${runId} alpha MGA` },
        { isActive: false, name: `STONE-87 ${runId} Inactive MGA` },
      ])
      .returning({ id: mgas.id });
    createdIds.mgas.push(...mgaRows.map(({ id }) => id));

    const officeRows = await database
      .insert(officeLocations)
      .values([
        { name: `STONE-87 ${runId} Zeta Office` },
        { name: `STONE-87 ${runId} alpha Office` },
        { isActive: false, name: `STONE-87 ${runId} Inactive Office` },
      ])
      .returning({ id: officeLocations.id });
    createdIds.offices.push(...officeRows.map(({ id }) => id));

    const policyTypeRows = await database
      .insert(policyTypes)
      .values([
        {
          classTag: "Commercial",
          name: `STONE-87 ${runId} Zeta Policy Type`,
        },
        {
          classTag: "Personal",
          name: `STONE-87 ${runId} alpha Policy Type`,
        },
        {
          classTag: "Life-Health",
          isActive: false,
          name: `STONE-87 ${runId} Inactive Policy Type`,
        },
      ])
      .returning({ id: policyTypes.id });
    createdIds.policyTypes.push(...policyTypeRows.map(({ id }) => id));

    const vocabulary = await loadActiveVocabulary(database);
    const ownCarriers = vocabulary.carriers.filter(({ id }) =>
      createdIds.carriers.includes(id),
    );
    const ownMgas = vocabulary.mgas.filter(({ id }) =>
      createdIds.mgas.includes(id),
    );
    const ownOffices = vocabulary.officeLocations.filter(({ id }) =>
      createdIds.offices.includes(id),
    );
    const ownPolicyTypes = vocabulary.policyTypes.filter(({ id }) =>
      createdIds.policyTypes.includes(id),
    );

    assert.equal(vocabulary.officeMode.kind, "multiple");
    assert.ok(vocabulary.officeMode.activeCount >= 2);

    assert.deepEqual(
      ownCarriers.map(({ name }) => name),
      [
        `STONE-87 ${runId} alpha Carrier`,
        `STONE-87 ${runId} Zeta Carrier`,
      ],
    );
    assert.deepEqual(
      ownMgas.map(({ name }) => name),
      [`STONE-87 ${runId} alpha MGA`, `STONE-87 ${runId} Zeta MGA`],
    );
    assert.deepEqual(
      ownOffices.map(({ name }) => name),
      [
        `STONE-87 ${runId} alpha Office`,
        `STONE-87 ${runId} Zeta Office`,
      ],
    );
    assert.deepEqual(
      ownPolicyTypes.map(({ name }) => name),
      [
        `STONE-87 ${runId} alpha Policy Type`,
        `STONE-87 ${runId} Zeta Policy Type`,
      ],
    );
    assert.deepEqual(ownPolicyTypes.map(({ classTag }) => classTag), [
      "Personal",
      "Commercial",
    ]);
    for (const entry of [...ownCarriers, ...ownMgas, ...ownOffices]) {
      assert.deepEqual(Object.keys(entry).sort(), ["id", "name"]);
    }
    for (const entry of ownPolicyTypes) {
      assert.deepEqual(Object.keys(entry).sort(), ["classTag", "id", "name"]);
    }
  } finally {
    if (createdIds.policyTypes.length > 0) {
      await database
        .delete(policyTypes)
        .where(inArray(policyTypes.id, createdIds.policyTypes));
    }
    if (createdIds.carriers.length > 0) {
      await database
        .delete(carriers)
        .where(inArray(carriers.id, createdIds.carriers));
    }
    if (createdIds.mgas.length > 0) {
      await database.delete(mgas).where(inArray(mgas.id, createdIds.mgas));
    }
    if (createdIds.offices.length > 0) {
      await database
        .delete(officeLocations)
        .where(inArray(officeLocations.id, createdIds.offices));
    }
    await pool.end();
  }
});
