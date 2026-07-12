import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adminOfficeManagementResponseSchema,
  createAdminOfficeRequestSchema,
  renameAdminOfficeRequestSchema,
} from "./admin-office-locations.js";

const ID = "00000000-0000-4000-8000-000000000001";

test("office names are normalized, bounded, and exact", () => {
  assert.deepEqual(createAdminOfficeRequestSchema.parse({ name: "  Chicago  " }), {
    name: "Chicago",
  });
  assert.deepEqual(renameAdminOfficeRequestSchema.parse({ name: " San Diego " }), {
    name: "San Diego",
  });
  assert.throws(() => createAdminOfficeRequestSchema.parse({ name: "   " }));
  assert.throws(() => createAdminOfficeRequestSchema.parse({ name: "x".repeat(201) }));
  assert.throws(() => createAdminOfficeRequestSchema.parse({ name: "Chicago", delete: true }));
});

test("office management mode is a strict zero, one, or many contract", () => {
  const item = {
    createdAt: "2026-07-01T00:00:00.000Z",
    id: ID,
    isActive: true,
    name: "Chicago",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
  const SECOND_ID = "00000000-0000-4000-8000-000000000002";
  for (const fixture of [
    {
      items: [{ ...item, isActive: false }],
      mode: { activeCount: 0, kind: "unconfigured", soleOfficeId: null },
    },
    {
      items: [item],
      mode: { activeCount: 1, kind: "single", soleOfficeId: ID },
    },
    {
      items: [item, { ...item, id: SECOND_ID, name: "Oakland" }],
      mode: { activeCount: 2, kind: "multiple", soleOfficeId: null },
    },
  ] as const) {
    assert.equal(
      adminOfficeManagementResponseSchema.parse(fixture).mode.kind,
      fixture.mode.kind,
    );
  }
  assert.throws(() =>
    adminOfficeManagementResponseSchema.parse({
      items: [item],
      mode: { activeCount: 1, kind: "single", soleOfficeId: null },
    }),
  );
  assert.throws(() =>
    adminOfficeManagementResponseSchema.parse({
      items: [item],
      mode: { activeCount: 2, kind: "multiple", soleOfficeId: ID },
    }),
  );
  assert.throws(() =>
    adminOfficeManagementResponseSchema.parse({
      items: [],
      mode: { activeCount: 1, kind: "single", soleOfficeId: ID },
    }),
  );
});
