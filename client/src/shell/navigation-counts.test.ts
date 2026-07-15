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
  });

  assert.deepEqual(counts, {
    approvals: 3,
    help_requests: 2,
    my_commissions: 5,
    my_items: 2,
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

test("badge loading fails closed when projected APIs are unavailable", async () => {
  const client: ApiClient = {
    async request() {
      throw new Error("network unavailable");
    },
  };

  assert.deepEqual(await loadNavigationCounts(client, producer), {});
});
