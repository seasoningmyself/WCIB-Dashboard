import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import {
  projectAdminVocabularyManagementSource,
  type AdminVocabularyManagementSource,
} from "./manage.js";

const ID = "00000000-0000-4000-8000-000000000001";

test("admin vocabulary projection is exact and default-denies non-admin roles", () => {
  const source: AdminVocabularyManagementSource = {
    carriers: [{ id: ID, inUse: true, isActive: true, name: "Carrier" }],
    mgas: [{ id: ID, inUse: false, isActive: false, name: "MGA" }],
    policyTypes: [
      {
        classTag: "Commercial",
        id: ID,
        inUse: false,
        isActive: true,
        name: "General Liability",
      },
    ],
  };
  assert.deepEqual(
    projectAdminVocabularyManagementSource(source, context("admin")),
    source,
  );
  assert.equal(
    projectAdminVocabularyManagementSource(source, context("employee")),
    null,
  );
  assert.equal(
    projectAdminVocabularyManagementSource(source, context("producer")),
    null,
  );
  assert.equal(
    JSON.stringify(
      projectAdminVocabularyManagementSource(source, context("admin")),
    ).includes("premiumTotal"),
    false,
  );
});

function context(
  role: "admin" | "employee" | "producer",
): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: role === "admin" ? ["admin"] : [],
      staffRole: role === "admin" ? null : role,
      userActive: true,
      userId: ID,
    },
  };
}
