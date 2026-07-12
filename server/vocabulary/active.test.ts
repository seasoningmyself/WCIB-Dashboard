import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccessPrincipal } from "../auth/access.js";
import {
  MAX_ACTIVE_VOCABULARY_ENTRIES_PER_TYPE,
  projectActiveVocabulary,
  VOCABULARY_READ_ACCESS,
  type ActiveVocabularySource,
} from "./active.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OPTION_ID = "00000000-0000-4000-8000-000000000002";

const source = {
  carriers: [
    {
      createdAt: "must not leak",
      id: OPTION_ID,
      isActive: true,
      name: "Travelers",
      policyCount: 17,
    },
  ],
  mgas: [
    {
      auditMetadata: "must not leak",
      id: OPTION_ID,
      name: "RPS",
      netDue: "100.00",
    },
  ],
  officeMode: { activeCount: 1, kind: "single", soleOfficeId: OPTION_ID },
  officeLocations: [
    { id: OPTION_ID, name: "Chicago", premiumTotal: "1000.00" },
  ],
  policyTypes: [
    {
      classTag: "Commercial",
      commissionRate: "0.25",
      id: OPTION_ID,
      name: "General Liability",
    },
  ],
} as unknown as ActiveVocabularySource;

function principal(
  overrides: Partial<AccessPrincipal> = {},
): AccessPrincipal {
  return {
    capabilities: [],
    staffRole: null,
    userActive: true,
    userId: USER_ID,
    ...overrides,
  };
}

test("active vocabulary projection allows approved roles and exact fields", () => {
  const expected = {
    carriers: [{ id: OPTION_ID, name: "Travelers" }],
    mgas: [{ id: OPTION_ID, name: "RPS" }],
    officeMode: { activeCount: 1, kind: "single", soleOfficeId: OPTION_ID },
    officeLocations: [{ id: OPTION_ID, name: "Chicago" }],
    policyTypes: [
      { classTag: "Commercial", id: OPTION_ID, name: "General Liability" },
    ],
  };

  for (const access of [
    { capabilities: ["admin"] as const },
    { staffRole: "employee" as const },
    { staffRole: "producer" as const },
  ]) {
    assert.deepEqual(
      projectActiveVocabulary(source, { principal: principal(access) }),
      expected,
    );
  }
});

test("active vocabulary projection defaults closed", () => {
  assert.deepEqual(VOCABULARY_READ_ACCESS, {
    capabilities: ["admin"],
    staffRoles: ["employee", "producer"],
  });
  assert.equal(MAX_ACTIVE_VOCABULARY_ENTRIES_PER_TYPE, 1_000);
  assert.equal(
    projectActiveVocabulary(source, { principal: principal() }),
    null,
  );
  assert.equal(
    projectActiveVocabulary(source, {
      principal: principal({
        capabilities: ["admin"],
        staffRole: "employee",
        userActive: false,
      }),
    }),
    null,
  );
});
