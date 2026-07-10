import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccessPrincipal } from "../auth/access.js";
import {
  calculateMgaNameSimilarity,
  evaluateMgaAddition,
  MGA_SIMILARITY_THRESHOLD,
} from "./mgas.js";

const admin: AccessPrincipal = {
  capabilities: ["admin"],
  staffRole: null,
  userActive: true,
  userId: "00000000-0000-4000-8000-000000000001",
};

const employee: AccessPrincipal = {
  capabilities: [],
  staffRole: "employee",
  userActive: true,
  userId: "00000000-0000-4000-8000-000000000002",
};

test("MGA name similarity reproduces the active v15 algorithm", () => {
  assert.equal(MGA_SIMILARITY_THRESHOLD, 0.75);
  assert.equal(calculateMgaNameSimilarity("AmTrust", "amtrust"), 1);
  assert.equal(calculateMgaNameSimilarity("A", "B"), 0);
  assert.equal(calculateMgaNameSimilarity("ABC", "ABCD"), 0.75);
  assert.equal(calculateMgaNameSimilarity("ABCD", "ABCE"), 0.75);
  assert.equal(calculateMgaNameSimilarity("ABCD", "WXYZ"), 0);
});

test("MGA add decisions deny non-admins before revealing vocabulary matches", () => {
  assert.deepEqual(
    evaluateMgaAddition({
      candidateName: "Existing MGA",
      existingNames: ["Existing MGA"],
      principal: employee,
    }),
    { kind: "denied", reason: "missing_required_access" },
  );
  assert.deepEqual(
    evaluateMgaAddition({
      candidateName: "Existing MGA",
      existingNames: ["Existing MGA"],
      principal: { ...admin, userActive: false },
    }),
    { kind: "denied", reason: "inactive_user" },
  );
});

test("MGA add decisions reject blanks and exact case-insensitive duplicates", () => {
  assert.deepEqual(
    evaluateMgaAddition({
      candidateName: "   ",
      existingNames: [],
      principal: admin,
    }),
    { kind: "invalid", reason: "blank_name" },
  );
  assert.deepEqual(
    evaluateMgaAddition({
      candidateName: "existing mga",
      existingNames: ["Existing MGA"],
      nearDuplicateConfirmed: true,
      principal: admin,
    }),
    { kind: "duplicate", name: "existing mga" },
  );
});

test("MGA near duplicates require explicit admin confirmation", () => {
  assert.deepEqual(
    evaluateMgaAddition({
      candidateName: "ABCD",
      existingNames: ["ABCE", "WXYZ"],
      principal: admin,
    }),
    {
      kind: "confirmation_required",
      name: "ABCD",
      similarNames: ["ABCE"],
    },
  );
  assert.deepEqual(
    evaluateMgaAddition({
      candidateName: "  ABCD  ",
      existingNames: ["ABCE", "WXYZ"],
      nearDuplicateConfirmed: true,
      principal: admin,
    }),
    { kind: "ready", name: "ABCD", similarNames: ["ABCE"] },
  );
  assert.deepEqual(
    evaluateMgaAddition({
      candidateName: "New MGA",
      existingNames: ["WXYZ"],
      principal: admin,
    }),
    { kind: "ready", name: "New MGA", similarNames: [] },
  );
});
