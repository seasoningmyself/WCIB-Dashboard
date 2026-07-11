import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeVocabularyResponseSchema,
  carrierMutationResponseSchema,
  createCarrierRequestSchema,
  createPolicyTypeRequestSchema,
  policyTypeMutationResponseSchema,
  VOCABULARY_NAME_MAX_LENGTH,
} from "./vocabulary.js";

const ID = "00000000-0000-4000-8000-000000000001";

test("active vocabulary response accepts only the picker contract", () => {
  assert.deepEqual(
    activeVocabularyResponseSchema.parse({
      carriers: [{ id: ID, name: "Travelers" }],
      mgas: [{ id: ID, name: "RPS" }],
      officeLocations: [{ id: ID, name: "Chicago" }],
      policyTypes: [
        { classTag: "Commercial", id: ID, name: "General Liability" },
      ],
    }),
    {
      carriers: [{ id: ID, name: "Travelers" }],
      mgas: [{ id: ID, name: "RPS" }],
      officeLocations: [{ id: ID, name: "Chicago" }],
      policyTypes: [
        { classTag: "Commercial", id: ID, name: "General Liability" },
      ],
    },
  );

  assert.equal(
    activeVocabularyResponseSchema.safeParse({
      carriers: [{ id: ID, isActive: true, name: "Travelers" }],
      mgas: [],
      officeLocations: [],
      policyTypes: [],
    }).success,
    false,
  );
  assert.equal(
    activeVocabularyResponseSchema.safeParse({
      carriers: [],
      mgas: [],
      officeLocations: [],
      policyTypes: [{ classTag: "Unknown", id: ID, name: "Other" }],
    }).success,
    false,
  );
});

test("vocabulary creation requests normalize bounded names and require class", () => {
  assert.deepEqual(
    createCarrierRequestSchema.parse({ name: "  Travelers  " }),
    { name: "Travelers" },
  );
  assert.deepEqual(
    createPolicyTypeRequestSchema.parse({
      classTag: "Commercial",
      name: "  General Liability  ",
    }),
    { classTag: "Commercial", name: "General Liability" },
  );

  for (const request of [
    {},
    { name: "   " },
    { name: "x".repeat(VOCABULARY_NAME_MAX_LENGTH + 1) },
    { extra: true, name: "Carrier" },
  ]) {
    assert.equal(createCarrierRequestSchema.safeParse(request).success, false);
  }
  for (const request of [
    { name: "Policy Type" },
    { classTag: "Unknown", name: "Policy Type" },
    { classTag: "Commercial", extra: true, name: "Policy Type" },
  ]) {
    assert.equal(
      createPolicyTypeRequestSchema.safeParse(request).success,
      false,
    );
  }
});

test("vocabulary mutation responses are exact picker-safe contracts", () => {
  assert.deepEqual(
    carrierMutationResponseSchema.parse({
      item: { id: ID, name: "Travelers" },
      outcome: "created",
    }),
    {
      item: { id: ID, name: "Travelers" },
      outcome: "created",
    },
  );
  assert.deepEqual(
    policyTypeMutationResponseSchema.parse({
      item: { classTag: "Commercial", id: ID, name: "General Liability" },
      outcome: "duplicate",
    }),
    {
      item: { classTag: "Commercial", id: ID, name: "General Liability" },
      outcome: "duplicate",
    },
  );
  assert.equal(
    carrierMutationResponseSchema.safeParse({
      item: { createdBy: ID, id: ID, name: "Travelers" },
      outcome: "created",
    }).success,
    false,
  );
});
