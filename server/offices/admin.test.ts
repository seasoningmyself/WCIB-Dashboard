import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import {
  deriveAdminOfficeMode,
  projectAdminOfficeManagementSource,
} from "./admin.js";

const IDS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
] as const;
const timestamp = new Date("2026-07-01T00:00:00.000Z");

test("office mode derives exact zero, one, and many states", () => {
  assert.deepEqual(deriveAdminOfficeMode([]), {
    activeCount: 0,
    kind: "unconfigured",
    soleOfficeId: null,
  });
  assert.deepEqual(deriveAdminOfficeMode([{ id: IDS[0], isActive: true }]), {
    activeCount: 1,
    kind: "single",
    soleOfficeId: IDS[0],
  });
  assert.deepEqual(
    deriveAdminOfficeMode([
      { id: IDS[0], isActive: true },
      { id: IDS[1], isActive: true },
    ]),
    { activeCount: 2, kind: "multiple", soleOfficeId: null },
  );
});

test("office management projection is admin-only and exact", () => {
  const source = {
    items: [
      {
        createdAt: timestamp,
        id: IDS[0],
        isActive: false,
        name: "Historical Office",
        updatedAt: timestamp,
      },
    ],
    mode: { activeCount: 0, kind: "unconfigured", soleOfficeId: null } as const,
  };
  const admin = context("admin", ["admin"]);
  const projected = projectAdminOfficeManagementSource(source, admin);
  assert.deepEqual(projected, {
    items: [
      {
        createdAt: timestamp.toISOString(),
        id: IDS[0],
        isActive: false,
        name: "Historical Office",
        updatedAt: timestamp.toISOString(),
      },
    ],
    mode: { activeCount: 0, kind: "unconfigured", soleOfficeId: null },
  });
  assert.equal(
    projectAdminOfficeManagementSource(source, context("employee", [])),
    null,
  );
});

function context(
  role: "admin" | "employee",
  capabilities: readonly "admin"[],
): AuthorizedRequestContext {
  return {
    principal: {
      capabilities,
      staffRole: role === "employee" ? "employee" : null,
      userActive: true,
      userId: IDS[1],
    },
  };
}
