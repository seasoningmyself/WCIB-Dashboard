import assert from "node:assert/strict";
import { test } from "node:test";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { ApiClient } from "../api/client.js";
import {
  loadNavigationCounts,
  navigationCountsFromProjectedData,
  visibleNavigationCount,
} from "./navigation-counts.js";

const producer: CurrentUser = {
  allowedNavigation: ["turn_in", "my_items", "my_commissions"],
  capabilities: [],
  displayName: "Producer",
  email: "producer@example.test",
  id: "00000000-0000-4000-8000-000000000001",
  role: "producer",
};

test("navigation counts match the corresponding projected screen sets", () => {
  const counts = navigationCountsFromProjectedData({
    approvalWork: {
      changeRequests: [],
      helpRequests: [
        {} as never,
        {} as never,
      ],
      submissions: [{ } as never, { } as never, { } as never],
    },
    myCommissions: {
      items: [],
      summary: {
        inReviewCount: 4,
        owedAmount: "125.00",
        owedCount: 5,
        paidLast30DaysAmount: "75.00",
        paidLast30DaysCount: 2,
      },
    },
    myItems: {
      items: [
        { status: "sent_back" } as never,
        { status: "draft" } as never,
        { status: "sent_back" } as never,
      ],
    },
    mgaPayables: {
      groups: [],
      status: "unpaid",
      summary: {
        outstandingAmount: "300.00",
        paidAmount: "100.00",
        paidCount: 1,
        totalCount: 4,
        unpaidCount: 3,
      },
    },
    paySheets: {
      items: [
        { policyCount: 2, status: "open" } as never,
        { policyCount: 4, status: "closed" } as never,
        { policyCount: 0, status: "open" } as never,
      ],
      query: {} as never,
    },
  });

  assert.deepEqual(counts, {
    approvals: 3,
    help_requests: 2,
    mga_payables: 3,
    my_commissions: 5,
    my_items: 2,
    pay_sheets: 1,
  });
  assert.equal(visibleNavigationCount(counts, "approvals"), 3);
  assert.equal(visibleNavigationCount({ approvals: 0 }, "approvals"), null);
});

test("producer badge loading calls only producer-authorized projected APIs", async () => {
  const paths: string[] = [];
  const client: ApiClient = {
    async request(path) {
      paths.push(path);
      if (path === "/my-items") {
        return Response.json({ items: [] });
      }
      if (path === "/my-commissions?search=&sort=insured") {
        return Response.json({
          items: [],
          summary: {
            inReviewCount: 0,
            owedAmount: "0.00",
            owedCount: 0,
            paidLast30DaysAmount: "0.00",
            paidLast30DaysCount: 0,
          },
        });
      }
      return new Response(null, { status: 404 });
    },
  };

  assert.deepEqual(await loadNavigationCounts(client, producer), {
    my_commissions: 0,
    my_items: 0,
  });
  assert.deepEqual(paths.sort(), [
    "/my-commissions?search=&sort=insured",
    "/my-items",
  ]);
});

test("admin badge loading uses the existing projected financial screen APIs", async () => {
  const paths: string[] = [];
  const client: ApiClient = {
    async request(path) {
      paths.push(path);
      if (path === "/mga-payables?status=unpaid") {
        return Response.json({
          groups: [],
          status: "unpaid",
          summary: {
            outstandingAmount: "300.00",
            paidAmount: "100.00",
            paidCount: 1,
            totalCount: 4,
            unpaidCount: 3,
          },
        });
      }
      if (path === "/pay-sheets?ownerType=all&status=all") {
        return Response.json({
          items: [paySheetSummary({ policyCount: 2, status: "open" })],
          query: {
            ownerType: "all",
            ownerUserId: null,
            periodMonth: null,
            periodYear: null,
            status: "all",
          },
        });
      }
      return new Response(null, { status: 404 });
    },
  };
  const admin: CurrentUser = {
    ...producer,
    allowedNavigation: ["mga_payables", "pay_sheets"],
    capabilities: ["admin"],
    role: "admin",
  };

  assert.deepEqual(await loadNavigationCounts(client, admin), {
    mga_payables: 3,
    pay_sheets: 1,
  });
  assert.deepEqual(paths.sort(), [
    "/mga-payables?status=unpaid",
    "/pay-sheets?ownerType=all&status=all",
  ]);
});

test("badge loading fails closed when projected APIs are unavailable", async () => {
  const client: ApiClient = {
    async request() {
      throw new Error("network unavailable");
    },
  };

  assert.deepEqual(await loadNavigationCounts(client, producer), {});
});

function paySheetSummary({
  policyCount,
  status,
}: {
  policyCount: number;
  status: "closed" | "open";
}) {
  return {
    adjustmentCount: 0,
    closeBlocker: policyCount === 0 ? "empty" : null,
    closedAt: status === "closed" ? "2026-07-01T12:00:00.000Z" : null,
    closedByUserId:
      status === "closed" ? "00000000-0000-4000-8000-000000000001" : null,
    id: "00000000-0000-4000-8000-000000000010",
    openedAt: "2026-06-01T12:00:00.000Z",
    ownerDisplayName: "Sophia",
    ownerType: "sophia",
    ownerUserId: "00000000-0000-4000-8000-000000000001",
    periodMonth: 6,
    periodYear: 2026,
    policyCount,
    status,
    totals: {
      brokerFees: "0.00",
      commissions: "0.00",
      directCheckAchIncome: "0.00",
      grandTotalIncome: "0.00",
      sophiaAgencyGross: "0.00",
      sophiaShare: "0.00",
      sophiaTakeHome: "0.00",
      trustPull: "0.00",
    },
    updatedAt: "2026-06-01T12:00:00.000Z",
  };
}
