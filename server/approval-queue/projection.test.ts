import assert from "node:assert/strict";
import { test } from "node:test";
import type { AccessPrincipal } from "../auth/access.js";
import type { ApprovalQueueEntryRecord } from "../db/schema.js";
import {
  OWN_APPROVAL_STATUS_FIELDS,
  projectAdminApprovalQueueEntry,
  projectOwnApprovalStatus,
} from "./projection.js";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000002";

function principal(
  input: Partial<AccessPrincipal> = {},
): AccessPrincipal {
  return {
    capabilities: [],
    staffRole: "employee",
    userActive: true,
    userId: OWNER_ID,
    ...input,
  };
}

function queueEntry(): ApprovalQueueEntryRecord {
  const timestamp = new Date("2026-07-01T12:00:00.000Z");
  return {
    actedAt: null,
    actedByUserId: null,
    createdAt: timestamp,
    draftId: "00000000-0000-4000-8000-000000000010",
    id: "00000000-0000-4000-8000-000000000020",
    reason: null,
    status: "pending",
    submittedAt: timestamp,
    submittedByUserId: OWNER_ID,
    submittedPayload: {
      basePremium: "1000.00",
      financeContact: { email: "private@example.test" },
      insuredName: "Private Insured",
      schemaVersion: 1,
    },
    updatedAt: timestamp,
  };
}

test("staff status projection cannot expose the submitted payload or action details", () => {
  const projected = projectOwnApprovalStatus(queueEntry(), {
    principal: principal(),
  });
  assert.ok(projected);
  assert.deepEqual(Object.keys(projected), OWN_APPROVAL_STATUS_FIELDS);
  assert.equal("submittedPayload" in projected, false);
  assert.equal("reason" in projected, false);
  assert.equal("actedByUserId" in projected, false);
  assert.equal("submittedByUserId" in projected, false);
});

test("staff status projection is owner-only and default-deny", () => {
  assert.equal(
    projectOwnApprovalStatus(queueEntry(), {
      principal: principal({ userId: OTHER_ID }),
    }),
    null,
  );
  assert.equal(
    projectOwnApprovalStatus(queueEntry(), {
      principal: principal({ staffRole: null }),
    }),
    null,
  );
  assert.equal(
    projectOwnApprovalStatus(queueEntry(), {
      principal: principal({ userActive: false }),
    }),
    null,
  );
});

test("only an active admin receives the explicit raw queue projection", () => {
  assert.equal(
    projectAdminApprovalQueueEntry(queueEntry(), {
      principal: principal(),
    }),
    null,
  );

  const admin = projectAdminApprovalQueueEntry(queueEntry(), {
    principal: principal({ capabilities: ["admin"], staffRole: null }),
  });
  assert.ok(admin);
  assert.deepEqual(admin.submittedPayload, queueEntry().submittedPayload);

  assert.equal(
    projectAdminApprovalQueueEntry(queueEntry(), {
      principal: principal({
        capabilities: ["admin"],
        staffRole: null,
        userActive: false,
      }),
    }),
    null,
  );
});
