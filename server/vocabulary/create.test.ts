import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccessPrincipal } from "../auth/access.js";
import {
  projectCarrierMutation,
  projectPolicyTypeMutation,
} from "./create.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const ITEM_ID = "00000000-0000-4000-8000-000000000002";

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

test("vocabulary mutation projectors return exact safe fields", () => {
  const carrier = projectCarrierMutation(
    {
      item: {
        createdBy: USER_ID,
        id: ITEM_ID,
        name: "Travelers",
        policyCount: 4,
      },
      outcome: "created",
    } as never,
    { principal: principal({ staffRole: "employee" }) },
  );
  const policyType = projectPolicyTypeMutation(
    {
      item: {
        classTag: "Commercial",
        id: ITEM_ID,
        name: "General Liability",
        premiumTotal: "1000.00",
      },
      outcome: "duplicate",
    } as never,
    { principal: principal({ capabilities: ["admin"] }) },
  );

  assert.deepEqual(carrier, {
    item: { id: ITEM_ID, name: "Travelers" },
    outcome: "created",
  });
  assert.deepEqual(policyType, {
    item: { classTag: "Commercial", id: ITEM_ID, name: "General Liability" },
    outcome: "duplicate",
  });
});

test("vocabulary mutation projectors default closed", () => {
  const carrier = {
    item: { id: ITEM_ID, name: "Travelers" },
    outcome: "created" as const,
  };
  assert.equal(
    projectCarrierMutation(carrier, { principal: principal() }),
    null,
  );
  assert.equal(
    projectCarrierMutation(carrier, {
      principal: principal({
        capabilities: ["admin"],
        userActive: false,
      }),
    }),
    null,
  );
});
