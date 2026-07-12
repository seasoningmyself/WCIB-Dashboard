import assert from "node:assert/strict";
import { test } from "node:test";
import type { CurrentUser } from "../../../shared/current-user.js";
import {
  adjustmentTypeLabel,
  closedSheetsForOwner,
  detailSourceLabel,
  formatPaySheetPeriod,
  formatPaySheetRate,
  groupPaySheetsByOwner,
  isPaySheetsAdmin,
  listPaySheetPeriods,
  openSheetForOwner,
  ownerHasPaySheetPeriod,
  paySheetExportQueryForScope,
  paySheetAccountLabel,
} from "./view-state.js";
import {
  paySheetDetailFixture,
  paySheetListFixture,
  uuid,
} from "./test-fixture.js";

test("owner grouping preserves server order and separates open from history", () => {
  const groups = groupPaySheetsByOwner(paySheetListFixture().items);
  assert.deepEqual(
    groups.map(({ key, label }) => [key, label]),
    [[`sophia:${uuid(1)}`, "Sophia"], [`producer:${uuid(2)}`, "Kaylee"]],
  );
  assert.equal(openSheetForOwner(groups[0]!)?.periodMonth, 7);
  assert.deepEqual(
    closedSheetsForOwner(groups[0]!).map(({ periodMonth }) => periodMonth),
    [6],
  );
});

test("export periods are unique, newest-first, and owner-scoped by UUID", () => {
  const data = paySheetListFixture();
  const periods = listPaySheetPeriods(data.items);
  const groups = groupPaySheetsByOwner(data.items);
  assert.deepEqual(
    periods.map(({ key, label }) => [key, label]),
    [["2026-07", "July 2026"], ["2026-06", "June 2026"]],
  );
  assert.equal(ownerHasPaySheetPeriod(groups[0]!, periods[1]!), true);
  assert.equal(ownerHasPaySheetPeriod(groups[1]!, periods[1]!), false);
  assert.deepEqual(paySheetExportQueryForScope("all", groups[1]!, periods[1]!), {
    ownerUserId: null,
    periodMonth: 6,
    periodYear: 2026,
  });
  assert.equal(
    paySheetExportQueryForScope("owner", groups[1]!, periods[1]!),
    null,
  );
  assert.deepEqual(
    paySheetExportQueryForScope("owner", groups[1]!, periods[0]!),
    {
      ownerUserId: uuid(2),
      periodMonth: 7,
      periodYear: 2026,
    },
  );
});

test("pay-sheet labels preserve exact period, rate, account, and source meaning", () => {
  assert.equal(formatPaySheetPeriod(7, 2026), "July 2026");
  assert.equal(formatPaySheetRate("25.00"), "25.00%");
  assert.equal(paySheetAccountLabel("own", null), "Sophia own account");
  assert.equal(paySheetAccountLabel("book", "Kaylee"), "Kaylee account");
  assert.equal(paySheetAccountLabel("house", "Kaylee"), "Kaylee first year");
  assert.equal(adjustmentTypeLabel("direct_deposit"), "Direct deposit");
  assert.equal(detailSourceLabel(paySheetDetailFixture()), "Current values");
  assert.equal(
    detailSourceLabel(
      paySheetDetailFixture({
        ...paySheetDetailFixture(),
        closedAt: "2026-07-31T00:00:00.000Z",
        closedByUserId: uuid(1),
        status: "closed",
      }),
    ),
    "Frozen history",
  );
});

test("pay-sheet UI access requires the trusted admin role and capability", () => {
  const base: CurrentUser = {
    allowedNavigation: ["pay_sheets"],
    capabilities: ["admin"],
    displayName: "Sophia",
    email: "sophia@example.test",
    id: uuid(1),
    role: "admin" as const,
  };
  assert.equal(isPaySheetsAdmin(base), true);
  assert.equal(isPaySheetsAdmin({ ...base, capabilities: [] }), false);
  assert.equal(
    isPaySheetsAdmin({ ...base, capabilities: [], role: "employee" }),
    false,
  );
});
