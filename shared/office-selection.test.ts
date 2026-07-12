import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deriveOfficeSelectionMode,
  officeSelectionModeMatches,
  officeSelectionModeSchema,
} from "./office-selection.js";

const OFFICE_A = "00000000-0000-4000-8000-000000000001";
const OFFICE_B = "00000000-0000-4000-8000-000000000002";

test("office selection derives the zero, one, and many active modes", () => {
  assert.deepEqual(deriveOfficeSelectionMode([]), {
    activeCount: 0,
    kind: "unconfigured",
    soleOfficeId: null,
  });
  assert.deepEqual(deriveOfficeSelectionMode([{ id: OFFICE_A }]), {
    activeCount: 1,
    kind: "single",
    soleOfficeId: OFFICE_A,
  });
  assert.deepEqual(
    deriveOfficeSelectionMode([{ id: OFFICE_A }, { id: OFFICE_B }]),
    { activeCount: 2, kind: "multiple", soleOfficeId: null },
  );
});

test("office mode agreement includes the exact sole office identity", () => {
  assert.equal(
    officeSelectionModeMatches(
      { activeCount: 1, kind: "single", soleOfficeId: OFFICE_A },
      [{ id: OFFICE_A }],
    ),
    true,
  );
  assert.equal(
    officeSelectionModeMatches(
      { activeCount: 1, kind: "single", soleOfficeId: OFFICE_A },
      [{ id: OFFICE_B }],
    ),
    false,
  );
});

test("office selection mode rejects inconsistent discriminator payloads", () => {
  assert.equal(
    officeSelectionModeSchema.safeParse({
      activeCount: 1,
      kind: "unconfigured",
      soleOfficeId: null,
    }).success,
    false,
  );
  assert.equal(
    officeSelectionModeSchema.safeParse({
      activeCount: 1,
      kind: "single",
      soleOfficeId: null,
    }).success,
    false,
  );
});
