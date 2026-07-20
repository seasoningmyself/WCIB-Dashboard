import assert from "node:assert/strict";
import { test } from "node:test";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { ApiClient } from "../api/client.js";
import { myItem, uuid } from "../my-items/test-fixture.js";
import { loadTurnInMetrics, staffTurnInMetrics } from "./turn-in-metrics.js";

test("staff metric pills match v15 counts and filter destinations", () => {
  const now = new Date("2026-07-17T16:00:00.000Z");
  assert.deepEqual(
    staffTurnInMetrics([
      myItem({ id: uuid(1), status: "draft" }),
      myItem({ id: uuid(2), status: "flagged" }),
      myItem({ id: uuid(3), status: "sent_back" }),
      myItem({
        id: uuid(4),
        status: "submitted",
        submittedAt: "2026-07-17T10:00:00.000Z",
      }),
      myItem({
        id: uuid(5),
        status: "submitted",
        submittedAt: "2026-07-16T10:00:00.000Z",
      }),
      myItem({ id: uuid(6), status: "approved" }),
    ], now),
    [
      { href: "#/my-drafts?filter=draft", label: "Drafts", value: 1 },
      {
        detail: "lifetime: 3",
        href: "#/my-drafts?filter=submitted",
        label: "Submitted today",
        value: 1,
      },
      { href: "#/my-drafts?filter=flagged", label: "Waiting on Sophia", value: 1 },
      { href: "#/my-drafts?filter=sent_back", label: "Sent back", value: 1 },
    ],
  );
});

test("producer metrics call only the projected My Items endpoint", async () => {
  const paths: string[] = [];
  const client: ApiClient = {
    async request(path) {
      paths.push(path);
      return Response.json({ items: [] });
    },
  };
  await loadTurnInMetrics(client, user("producer", ["turn_in", "my_items"]));
  assert.deepEqual(paths, ["/my-items"]);
});

test("admin metrics reuse approval, ledger-month, and unpaid-payables endpoints", async () => {
  const paths: string[] = [];
  const client: ApiClient = {
    async request(path) {
      paths.push(path);
      if (path === "/approvals") {
        return Response.json({
          changeRequests: [],
          helpRequests: [
            { draft: helpDraft(uuid(20)), submitterDisplayName: "Mercedes" },
            { draft: helpDraft(uuid(21)), submitterDisplayName: "Kaylee" },
          ],
          submissions: [
            { entry: pendingEntry(), submitterDisplayName: "Mercedes" },
          ],
        });
      }
      if (path.startsWith("/policies?")) {
        return Response.json({
          filteredTotal: 7,
          hasMore: false,
          items: [],
          limit: 100,
          month: "2026-07",
          offset: 0,
          total: 7,
          totals: {
            agencyRevenue: "0.00",
            amountPaid: "0.00",
            brokerFee: "0.00",
            commissionAmount: "0.00",
            producerPayout: "0.00",
            sophiaRetained: "0.00",
          },
        });
      }
      if (path === "/mga-payables?status=unpaid") {
        return Response.json({
          groups: [],
          status: "unpaid",
          summary: {
            outstandingAmount: "0.00",
            paidAmount: "0.00",
            paidCount: 0,
            totalCount: 4,
            unpaidCount: 4,
          },
        });
      }
      return new Response(null, { status: 404 });
    },
  };
  const metrics = await loadTurnInMetrics(
    client,
    user("admin", ["approvals", "help_requests", "policy_ledger", "mga_payables"]),
    new Date("2026-07-17T12:00:00.000Z"),
  );
  assert.deepEqual(metrics.map(({ label, value }) => [label, value]), [
    ["Approvals waiting", 1],
    ["Help Requests", 2],
    ["Policies in ledger", 7],
    ["MGA payables", 4],
  ]);
  assert.equal(paths.some((path) => path.includes("month=2026-07")), true);
});

function helpDraft(id: string) {
  const at = "2026-07-17T10:00:00.000Z";
  return {
    accountAssignment: "none",
    carrierId: null,
    companyName: null,
    createdAt: at,
    effectiveDate: null,
    expirationDate: null,
    flagReason: "Need help",
    history: [],
    id,
    insuredName: "Metric insured",
    invoiceNumber: null,
    lastEditedAt: at,
    linkedPolicyId: null,
    linkedQueueEntryId: null,
    mgaId: null,
    notes: null,
    officeLocationId: null,
    ownerUserId: uuid(30),
    policyNumber: null,
    policyTypeId: null,
    producerUserId: null,
    schemaVersion: 1,
    sentBackAt: null,
    sentBackByUserId: null,
    sentBackReason: null,
    status: "flagged",
    submittedAt: null,
    transactionNotes: null,
    transactionType: null,
  };
}

function pendingEntry() {
  const at = "2026-07-17T10:00:00.000Z";
  return {
    actedAt: null,
    actedByUserId: null,
    createdAt: at,
    draftId: uuid(40),
    id: uuid(41),
    reason: null,
    status: "pending",
    submittedAt: at,
    submittedByUserId: uuid(42),
    submittedPayload: {},
    updatedAt: at,
  };
}

function user(
  role: CurrentUser["role"],
  allowedNavigation: CurrentUser["allowedNavigation"],
): CurrentUser {
  return {
    allowedNavigation,
    capabilities: role === "admin" ? ["admin"] : [],
    displayName: "Metric User",
    email: "metric@example.test",
    id: uuid(9),
    passwordChangeRequired: false,
    role,
  };
}
