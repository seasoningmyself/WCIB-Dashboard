import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiClient } from "../api/client.js";
import {
  AgencyOverviewApiError,
  loadAgencyOverview,
} from "./overview.js";

test("agency overview reuses existing bounded business projections", async () => {
  const paths: string[] = [];
  const client: ApiClient = {
    async request(path) {
      paths.push(path);
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
            agencyRevenue: "1509.39",
            amountPaid: "4509.39",
            brokerFee: "525.00",
            commissionAmount: "984.39",
            producerPayout: "511.17",
            sophiaRetained: "998.22",
          },
        });
      }
      if (path === "/approvals") {
        return Response.json({
          changeRequests: [
            {
              insuredName: "Change request insured",
              policyNumber: "WCIB-CHANGE-1",
              request: {
                id: uuid(10),
                mutationId: null,
                mutationKind: null,
                policyId: uuid(11),
                reason: "Correct account",
                requestedAt: "2026-07-23T11:00:00.000Z",
                requestedByUserId: uuid(12),
                resolution: null,
                resolutionReason: null,
                resolvedAt: null,
                resolvedByUserId: null,
                status: "pending",
              },
              requesterDisplayName: "Mercedes",
            },
          ],
          helpRequests: [
            { draft: helpDraft(uuid(20)), submitterDisplayName: "Mercedes" },
          ],
          submissions: [
            { entry: pendingEntry(uuid(30), uuid(31)), submitterDisplayName: "Mercedes" },
            { entry: pendingEntry(uuid(32), uuid(33)), submitterDisplayName: "Kaylee" },
          ],
        });
      }
      if (path === "/mga-payables?status=unpaid") {
        return Response.json({
          groups: [],
          status: "unpaid",
          summary: {
            outstandingAmount: "3000.00",
            paidAmount: "0.00",
            paidCount: 0,
            totalCount: 6,
            unpaidCount: 6,
          },
        });
      }
      if (path === "/kpi-activity") {
        return Response.json({
          activities: [
            {
              actionType: "policy_approved",
              actorDisplayName: "Sophia",
              occurredAt: "2026-07-23T12:00:00.000Z",
              targetReference: "Policy WCIB-1001",
            },
          ],
        });
      }
      return new Response(null, { status: 404 });
    },
  };

  const result = await loadAgencyOverview(
    client,
    new Date("2026-07-23T12:00:00.000Z"),
  );

  assert.equal(
    paths.some((path) => path.includes("month=2026-07")),
    true,
  );
  assert.deepEqual(
    [...paths].sort(),
    [
      "/approvals",
      "/kpi-activity",
      "/mga-payables?status=unpaid",
      "/policies?duplicates=all&finance=all&limit=100&offset=0&search=&sort=insured&month=2026-07",
    ].sort(),
  );
  assert.deepEqual(result, {
    activities: [
      {
        actionType: "policy_approved",
        actorDisplayName: "Sophia",
        occurredAt: "2026-07-23T12:00:00.000Z",
        targetReference: "Policy WCIB-1001",
      },
    ],
    agencyRevenue: "1509.39",
    helpRequestCount: 1,
    month: "2026-07",
    outstandingMgaAmount: "3000.00",
    outstandingMgaCount: 6,
    policyChangeRequestCount: 1,
    policiesApproved: 7,
    reviewItemCount: 4,
    submittedTurnInCount: 2,
  });
});

test("agency overview uses the ledger UTC month at a local-month boundary", async () => {
  const paths: string[] = [];
  const client: ApiClient = {
    async request(path) {
      paths.push(path);
      if (path.startsWith("/policies?")) {
        return Response.json({
          filteredTotal: 0,
          hasMore: false,
          items: [],
          limit: 100,
          month: "2026-07",
          offset: 0,
          total: 0,
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
      if (path === "/approvals") {
        return Response.json({
          changeRequests: [],
          helpRequests: [],
          submissions: [],
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
            totalCount: 0,
            unpaidCount: 0,
          },
        });
      }
      if (path === "/kpi-activity") {
        return Response.json({ activities: [] });
      }
      return new Response(null, { status: 404 });
    },
  };

  const result = await loadAgencyOverview(
    client,
    new Date("2026-08-01T00:30:00+02:00"),
  );

  assert.equal(result.month, "2026-07");
  assert.equal(
    paths.some((path) => path.includes("month=2026-07")),
    true,
  );
});

test("agency overview preserves denied access across reused projections", async () => {
  const client: ApiClient = {
    async request() {
      return new Response(null, { status: 403 });
    },
  };

  await assert.rejects(
    loadAgencyOverview(client),
    (error: unknown) =>
      error instanceof AgencyOverviewApiError &&
      error.kind === "denied",
  );
});

function helpDraft(id: string) {
  const at = "2026-07-23T10:00:00.000Z";
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
    insuredName: "Overview insured",
    invoiceNumber: null,
    lastEditedAt: at,
    linkedPolicyId: null,
    linkedQueueEntryId: null,
    mgaId: null,
    notes: null,
    officeLocationId: null,
    ownerUserId: uuid(40),
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

function pendingEntry(id: string, draftId: string) {
  const at = "2026-07-23T10:00:00.000Z";
  return {
    actedAt: null,
    actedByUserId: null,
    createdAt: at,
    draftId,
    id,
    reason: null,
    status: "pending",
    submittedAt: at,
    submittedByUserId: uuid(41),
    submittedPayload: {},
    updatedAt: at,
  };
}

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}
