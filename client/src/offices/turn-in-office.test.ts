import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActiveVocabularyResponse } from "../../../shared/vocabulary.js";
import { normalizeTurnInOfficeSelection } from "./turn-in-office.js";

const OFFICE_A = "00000000-0000-4000-8000-000000000001";
const OFFICE_B = "00000000-0000-4000-8000-000000000002";
const STALE = "00000000-0000-4000-8000-000000000003";

test("turn-in office selection blocks zero, auto-selects one, and validates many", () => {
  assert.equal(normalizeTurnInOfficeSelection(vocabulary([]), STALE), null);
  assert.equal(
    normalizeTurnInOfficeSelection(vocabulary([{ id: OFFICE_A, name: "SF" }]), null),
    OFFICE_A,
  );
  const many = vocabulary([
    { id: OFFICE_A, name: "SF" },
    { id: OFFICE_B, name: "Oakland" },
  ]);
  assert.equal(normalizeTurnInOfficeSelection(many, OFFICE_B), OFFICE_B);
  assert.equal(normalizeTurnInOfficeSelection(many, STALE), null);
});

function vocabulary(
  officeLocations: ActiveVocabularyResponse["officeLocations"],
): ActiveVocabularyResponse {
  const activeCount = officeLocations.length;
  return {
    carriers: [],
    mgas: [],
    officeLocations,
    officeMode:
      activeCount === 0
        ? { activeCount: 0, kind: "unconfigured", soleOfficeId: null }
        : activeCount === 1
          ? { activeCount: 1, kind: "single", soleOfficeId: officeLocations[0]!.id }
          : { activeCount, kind: "multiple", soleOfficeId: null },
    policyTypes: [],
  };
}
