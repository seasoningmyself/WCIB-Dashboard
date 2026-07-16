import type { MyItem } from "../../../shared/my-items.js";

export function myItem(overrides: Partial<MyItem> = {}): MyItem {
  return {
    id: uuid(1),
    lastActivityAt: "2026-07-11T12:00:00.000Z",
    mgaName: "Summit MGA",
    policyNumber: "POL-1001",
    reason: null,
    status: "draft",
    submittedAt: null,
    title: "Acme Construction",
    ...overrides,
  };
}

export function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}
