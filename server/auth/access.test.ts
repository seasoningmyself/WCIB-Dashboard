import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accessDenialReasons,
  buildAccessPrincipal,
  evaluateAccess,
  type AccessPrincipal,
} from "./access.js";

function principal(
  overrides: Partial<AccessPrincipal> = {},
): AccessPrincipal {
  return {
    capabilities: [],
    staffRole: null,
    userActive: true,
    userId: "00000000-0000-4000-8000-000000000001",
    ...overrides,
  };
}

test("employee and producer roles grant only explicitly listed roles", () => {
  const employee = principal({ staffRole: "employee" });
  const producer = principal({ staffRole: "producer" });

  assert.deepEqual(evaluateAccess(employee, { staffRoles: ["employee"] }), {
    allowed: true,
  });
  assert.deepEqual(evaluateAccess(employee, { staffRoles: ["producer"] }), {
    allowed: false,
    reason: accessDenialReasons.missingRequiredAccess,
  });
  assert.deepEqual(evaluateAccess(producer, { staffRoles: ["producer"] }), {
    allowed: true,
  });
  assert.deepEqual(evaluateAccess(producer, { staffRoles: ["employee"] }), {
    allowed: false,
    reason: accessDenialReasons.missingRequiredAccess,
  });
  assert.deepEqual(
    evaluateAccess(producer, { capabilities: ["admin"] }),
    {
      allowed: false,
      reason: accessDenialReasons.missingRequiredAccess,
    },
  );
});

test("admin capability works without a staff profile", () => {
  const admin = buildAccessPrincipal({
    capabilities: [{ capability: "admin", isActive: true }],
    staffProfile: null,
    userActive: true,
    userId: "00000000-0000-4000-8000-000000000002",
  });

  assert.equal(admin.staffRole, null);
  assert.deepEqual(evaluateAccess(admin, { capabilities: ["admin"] }), {
    allowed: true,
  });
});

test("support capability is exact and does not inherit administrator access", () => {
  const support = buildAccessPrincipal({
    capabilities: [{ capability: "support_engineer", isActive: true }],
    staffProfile: null,
    userActive: true,
    userId: "00000000-0000-4000-8000-000000000005",
  });
  const admin = principal({ capabilities: ["admin"] });

  assert.deepEqual(
    evaluateAccess(support, { capabilities: ["support_engineer"] }),
    { allowed: true },
  );
  assert.deepEqual(evaluateAccess(support, { capabilities: ["admin"] }), {
    allowed: false,
    reason: accessDenialReasons.missingRequiredAccess,
  });
  assert.deepEqual(
    evaluateAccess(admin, { capabilities: ["support_engineer"] }),
    {
      allowed: false,
      reason: accessDenialReasons.missingRequiredAccess,
    },
  );
});

test("empty requirements deny every principal including admin", () => {
  const admin = principal({ capabilities: ["admin"] });

  assert.deepEqual(evaluateAccess(admin, {}), {
    allowed: false,
    reason: accessDenialReasons.defaultDeny,
  });
});

test("inactive users lose all role and capability access", () => {
  const inactive = buildAccessPrincipal({
    capabilities: [{ capability: "admin", isActive: true }],
    staffProfile: { isActive: true, role: "producer" },
    userActive: false,
    userId: "00000000-0000-4000-8000-000000000003",
  });

  assert.deepEqual(inactive.capabilities, []);
  assert.equal(inactive.staffRole, null);
  assert.deepEqual(
    evaluateAccess(inactive, {
      capabilities: ["admin"],
      staffRoles: ["producer"],
    }),
    { allowed: false, reason: accessDenialReasons.inactiveUser },
  );
});

test("inactive profiles and unknown capabilities fail closed", () => {
  const unresolved = buildAccessPrincipal({
    capabilities: [
      { capability: "future_permission", isActive: true },
      { capability: "admin", isActive: false },
    ],
    staffProfile: { isActive: false, role: "producer" },
    userActive: true,
    userId: "00000000-0000-4000-8000-000000000004",
  });

  assert.equal(unresolved.staffRole, null);
  assert.deepEqual(unresolved.capabilities, []);
  assert.deepEqual(
    evaluateAccess(unresolved, {
      capabilities: ["admin"],
      staffRoles: ["producer"],
    }),
    {
      allowed: false,
      reason: accessDenialReasons.missingRequiredAccess,
    },
  );
});
