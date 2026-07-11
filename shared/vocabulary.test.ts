import assert from "node:assert/strict";
import { test } from "node:test";
import { activeVocabularyResponseSchema } from "./vocabulary.js";

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
