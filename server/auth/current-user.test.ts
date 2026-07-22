import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccessPrincipal } from "./access.js";
import {
  allowedNavigationForPrincipal,
  CurrentUserProjectionError,
  projectCurrentUser,
} from "./current-user.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";

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

test("current-user navigation is an exact server-owned role policy", () => {
  assert.deepEqual(
    allowedNavigationForPrincipal(
      principal({ capabilities: ["admin"], staffRole: "producer" }),
    ),
    [
      "approvals",
      "help_requests",
      "policy_ledger",
      "mga_payables",
      "pay_sheets",
      "kpis",
      "manage_staff",
      "settings",
      "turn_in",
      "my_items",
    ],
  );
  assert.deepEqual(
    allowedNavigationForPrincipal(principal({ staffRole: "employee" })),
    ["turn_in", "my_items", "settings"],
  );
  assert.deepEqual(
    allowedNavigationForPrincipal(principal({ staffRole: "producer" })),
    ["turn_in", "my_items", "my_commissions", "settings"],
  );
  assert.deepEqual(
    allowedNavigationForPrincipal(
      principal({ capabilities: ["support_engineer"] }),
    ),
    ["support", "settings"],
  );
  assert.deepEqual(
    allowedNavigationForPrincipal(
      principal({ capabilities: ["admin", "support_engineer"] }),
    ),
    [
      "support",
      "approvals",
      "help_requests",
      "policy_ledger",
      "mga_payables",
      "pay_sheets",
      "kpis",
      "manage_staff",
      "turn_in",
      "my_items",
      "settings",
    ],
  );
  assert.deepEqual(allowedNavigationForPrincipal(principal()), []);
  assert.deepEqual(
    allowedNavigationForPrincipal(principal({ userActive: false })),
    [],
  );
});

test("current-user projection exposes only the explicit account contract", () => {
  const response = projectCurrentUser(
    {
      displayName: "Sophia",
      email: "sophia@example.test",
      id: USER_ID,
      passwordChangeRequiredAt: null,
    },
    { principal: principal({ capabilities: ["admin"] }) },
  );

  assert.deepEqual(response, {
    user: {
      allowedNavigation: [
        "approvals",
        "help_requests",
        "policy_ledger",
        "mga_payables",
        "pay_sheets",
        "kpis",
        "manage_staff",
        "settings",
        "turn_in",
        "my_items",
      ],
      authenticationState: "authenticated",
      capabilities: ["admin"],
      displayName: "Sophia",
      email: "sophia@example.test",
      id: USER_ID,
      passwordChangeRequired: false,
      role: "admin",
    },
  });

  const keys = collectKeys(response);
  for (const forbidden of [
    "agencyGross",
    "agencyTotal",
    "basePremium",
    "collectedToDate",
    "commissionAmount",
    "commissionRate",
    "mgaId",
    "mgaPaid",
    "netDue",
    "netDueTotal",
    "passwordHash",
    "paySheetId",
    "premiumTotal",
    "resetToken",
    "sessionSecret",
  ]) {
    assert.equal(keys.has(forbidden), false, forbidden);
  }
});

test("current-user projection rejects mismatched or inactive identity", () => {
  const identity = {
    displayName: "User",
    email: "user@example.test",
    id: USER_ID,
    passwordChangeRequiredAt: null,
  };

  assert.throws(
    () =>
      projectCurrentUser(identity, {
        principal: principal({
          userId: "00000000-0000-4000-8000-000000000002",
        }),
      }),
    CurrentUserProjectionError,
  );
  assert.throws(
    () =>
      projectCurrentUser(identity, {
        principal: principal({ userActive: false }),
      }),
    CurrentUserProjectionError,
  );
});

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, keys);
    }
    return keys;
  }
  if (value === null || typeof value !== "object") {
    return keys;
  }
  for (const [key, item] of Object.entries(value)) {
    keys.add(key);
    collectKeys(item, keys);
  }
  return keys;
}
