import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccessPrincipal } from "../auth/access.js";
import {
  evaluateCarrierAddition,
  evaluatePolicyTypeAddition,
  VOCABULARY_ADD_ACCESS,
} from "./add-rules.js";

function principal(
  input: Partial<AccessPrincipal> = {},
): AccessPrincipal {
  return {
    capabilities: [],
    staffRole: null,
    userActive: true,
    userId: "00000000-0000-4000-8000-000000000001",
    ...input,
  };
}

test("vocabulary add access names every approved role and capability", () => {
  assert.deepEqual(VOCABULARY_ADD_ACCESS, {
    capabilities: ["admin"],
    staffRoles: ["employee", "producer"],
  });

  for (const allowedPrincipal of [
    principal({ capabilities: ["admin"] }),
    principal({ staffRole: "employee" }),
    principal({ staffRole: "producer" }),
  ]) {
    assert.deepEqual(
      evaluateCarrierAddition({
        candidateName: "Carrier",
        existingNames: [],
        principal: allowedPrincipal,
      }),
      { kind: "ready", record: { name: "Carrier" } },
    );
  }
});

test("vocabulary add decisions deny anonymous, inactive, and unassigned users", () => {
  assert.deepEqual(
    evaluateCarrierAddition({
      candidateName: "Existing Carrier",
      existingNames: ["Existing Carrier"],
      principal: null,
    }),
    { kind: "denied", reason: "unauthenticated" },
  );
  assert.deepEqual(
    evaluateCarrierAddition({
      candidateName: "Carrier",
      existingNames: [],
      principal: principal({ staffRole: "employee", userActive: false }),
    }),
    { kind: "denied", reason: "inactive_user" },
  );
  assert.deepEqual(
    evaluateCarrierAddition({
      candidateName: "Carrier",
      existingNames: [],
      principal: principal(),
    }),
    { kind: "denied", reason: "missing_required_access" },
  );
});

test("carrier additions return only a normalized vocabulary insert", () => {
  assert.deepEqual(
    evaluateCarrierAddition({
      candidateName: "  New Carrier  ",
      existingNames: [],
      principal: principal({ staffRole: "employee" }),
    }),
    { kind: "ready", record: { name: "New Carrier" } },
  );
  assert.deepEqual(
    evaluateCarrierAddition({
      candidateName: "existing carrier",
      existingNames: ["Existing Carrier"],
      principal: principal({ staffRole: "producer" }),
    }),
    { kind: "duplicate", name: "existing carrier" },
  );
});

test("policy type additions require an approved class and vocabulary-only DTO", () => {
  const producer = principal({ staffRole: "producer" });
  assert.deepEqual(
    evaluatePolicyTypeAddition({
      candidateName: "Policy Type",
      classTag: undefined,
      existingNames: [],
      principal: producer,
    }),
    { kind: "invalid", reason: "class_required" },
  );
  assert.deepEqual(
    evaluatePolicyTypeAddition({
      candidateName: "Policy Type",
      classTag: "Business",
      existingNames: [],
      principal: producer,
    }),
    { kind: "invalid", reason: "unknown_class" },
  );
  assert.deepEqual(
    evaluatePolicyTypeAddition({
      candidateName: "  Cyber Liability  ",
      classTag: "Commercial",
      existingNames: [],
      principal: producer,
    }),
    {
      kind: "ready",
      record: { classTag: "Commercial", name: "Cyber Liability" },
    },
  );
});
