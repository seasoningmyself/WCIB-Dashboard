import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiClient, ApiRequestOptions } from "../api/client.js";
import { ApprovalApiError, createApprovalApi } from "./api.js";

const QUEUE_ID = "00000000-0000-4000-8000-000000000501";
const DRAFT_ID = "00000000-0000-4000-8000-000000000502";
const POLICY_ID = "00000000-0000-4000-8000-000000000503";
const OVERRIDE_ID = "00000000-0000-4000-8000-000000000504";
const CHANGE_REQUEST_ID = "00000000-0000-4000-8000-000000000505";

test("approval API uses every live Parent D endpoint and safe request body", async () => {
  const calls: Array<{ options?: ApiRequestOptions; path: string }> = [];
  const responses = [
    Response.json({ changeRequests: [], helpRequests: [], submissions: [] }),
    policyResponse(),
    Response.json({ overrideId: OVERRIDE_ID, ...policyResponseBody() }, { status: 201 }),
    Response.json({ entry: queueEntry("sent_back") }),
    policyResponse(),
    policyResponse(),
    Response.json({ draft: draftResponse("sent_back") }),
    Response.json({
      policyId: POLICY_ID,
      request: changeRequestResponse("corrected"),
    }),
    Response.json({ request: changeRequestResponse("as_is") }),
    Response.json({ request: changeRequestResponse("sent_back") }),
  ];
  const client: ApiClient = {
    async request(path, options) {
      calls.push({ options, path });
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
  };
  const api = createApprovalApi(client);

  await api.list({ status: "all" });
  await api.approve(QUEUE_ID);
  await api.approveWithOverride(QUEUE_ID, {
    changedFields: ["brokerFee"],
    reason: "Carrier correction",
    replacementValues: { brokerFee: "30.00" },
  });
  await api.sendBackSubmission(QUEUE_ID, { reason: "Correct carrier" });
  await api.pushThroughHelp(DRAFT_ID);
  await api.openFixHelp(DRAFT_ID, { insuredName: "Corrected insured" });
  await api.sendBackHelp(DRAFT_ID, { reason: "Complete finance fields" });
  await api.correctPolicyChangeRequest(CHANGE_REQUEST_ID, {
    change: {
      changedFields: ["insuredName"],
      reason: "Correct the approved record",
      replacementValues: { insuredName: "Corrected insured" },
    },
    expectedUpdatedAt: "2026-07-14T12:00:00.000Z",
    kind: "general",
  });
  await api.resolvePolicyChangeRequestAsIs(CHANGE_REQUEST_ID);
  await api.sendBackPolicyChangeRequest(CHANGE_REQUEST_ID, {
    reason: "No ledger correction is required",
  });

  assert.deepEqual(
    calls.map(({ path }) => path),
    [
      "/approvals",
      `/approvals/${QUEUE_ID}/approve`,
      `/approvals/${QUEUE_ID}/approve-with-override`,
      `/approvals/${QUEUE_ID}/send-back`,
      `/approvals/help/${DRAFT_ID}/push-through`,
      `/approvals/help/${DRAFT_ID}/open-fix`,
      `/approvals/help/${DRAFT_ID}/send-back`,
      `/policy-change-requests/${CHANGE_REQUEST_ID}/correction`,
      `/policy-change-requests/${CHANGE_REQUEST_ID}/resolve-as-is`,
      `/policy-change-requests/${CHANGE_REQUEST_ID}/send-back`,
    ],
  );
  assert.equal(calls[0]?.options?.cache, "no-store");
  assert.deepEqual(JSON.parse(String(calls[1]?.options?.body)), {});
  assert.deepEqual(JSON.parse(String(calls[2]?.options?.body)), {
    changedFields: ["brokerFee"],
    reason: "Carrier correction",
    replacementValues: { brokerFee: "30.00" },
  });
  assert.deepEqual(JSON.parse(String(calls[3]?.options?.body)), {
    reason: "Correct carrier",
  });
  assert.deepEqual(JSON.parse(String(calls[5]?.options?.body)), {
    insuredName: "Corrected insured",
  });
  assert.equal(calls[7]?.options?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(calls[8]?.options?.body)), {});
  assert.deepEqual(JSON.parse(String(calls[9]?.options?.body)), {
    reason: "No ledger correction is required",
  });
});

test("approval API rejects unsafe input and normalizes response failures", async () => {
  const neverClient: ApiClient = {
    async request() {
      throw new Error("must not run");
    },
  };
  const api = createApprovalApi(neverClient);
  await assert.rejects(
    api.approveWithOverride(QUEUE_ID, {
      changedFields: ["insuredName"],
      reason: "Unsafe",
      replacementValues: { insuredName: "Private" },
    } as never),
    (error: unknown) =>
      error instanceof ApprovalApiError && error.kind === "rejected",
  );
  await assert.rejects(
    api.sendBackHelp(DRAFT_ID, { reason: "" }),
    (error: unknown) =>
      error instanceof ApprovalApiError && error.kind === "rejected",
  );

  for (const [status, kind] of [
    [403, "denied"],
    [409, "conflict"],
    [500, "unavailable"],
  ] as const) {
    await assert.rejects(
      createApprovalApi({
        async request() {
          return new Response(null, { status });
        },
      }).approve(QUEUE_ID),
      (error: unknown) =>
        error instanceof ApprovalApiError && error.kind === kind,
    );
  }
  await assert.rejects(
    createApprovalApi({
      async request() {
        return Response.json({ policy: { id: "bad" } }, { status: 201 });
      },
    }).approve(QUEUE_ID),
    (error: unknown) =>
      error instanceof ApprovalApiError && error.kind === "invalid_response",
  );
});

function policyResponse(): Response {
  return Response.json(policyResponseBody(), { status: 201 });
}

function policyResponseBody() {
  return { policy: { id: POLICY_ID, basePremium: "1000.00" } };
}

function queueEntry(status: "pending" | "sent_back") {
  const timestamp = "2026-07-11T12:00:00.000Z";
  return {
    actedAt: status === "sent_back" ? timestamp : null,
    actedByUserId: status === "sent_back" ? POLICY_ID : null,
    createdAt: timestamp,
    draftId: DRAFT_ID,
    id: QUEUE_ID,
    reason: status === "sent_back" ? "Correct carrier" : null,
    status,
    submittedAt: timestamp,
    submittedByUserId: POLICY_ID,
    submittedPayload: {},
    updatedAt: timestamp,
  };
}

function draftResponse(status: "flagged" | "sent_back") {
  const timestamp = "2026-07-11T12:00:00.000Z";
  return {
    accountAssignment: "none",
    carrierId: null,
    companyName: null,
    createdAt: timestamp,
    effectiveDate: null,
    expirationDate: null,
    flagReason: status === "flagged" ? "Need help" : null,
    history: [],
    id: DRAFT_ID,
    insuredName: "Insured",
    invoiceNumber: null,
    lastEditedAt: timestamp,
    linkedPolicyId: null,
    linkedQueueEntryId: null,
    mgaId: null,
    notes: null,
    officeLocationId: null,
    ownerUserId: POLICY_ID,
    policyNumber: "P-1",
    policyTypeId: null,
    producerUserId: null,
    schemaVersion: 1,
    sentBackAt: status === "sent_back" ? timestamp : null,
    sentBackByUserId: status === "sent_back" ? POLICY_ID : null,
    sentBackReason: status === "sent_back" ? "Complete finance fields" : null,
    status,
    submittedAt: null,
    transactionNotes: null,
    transactionType: "New",
  };
}

function changeRequestResponse(
  resolution: "as_is" | "corrected" | "sent_back",
) {
  const timestamp = "2026-07-14T12:00:00.000Z";
  return {
    insuredName: "Corrected insured",
    policyNumber: "P-1",
    requesterDisplayName: "Policy Owner",
    request: {
      id: CHANGE_REQUEST_ID,
      mutationId: resolution === "corrected" ? OVERRIDE_ID : null,
      mutationKind: resolution === "corrected" ? "general" : null,
      policyId: POLICY_ID,
      reason: "Please review the approved record",
      requestedAt: timestamp,
      requestedByUserId: POLICY_ID,
      resolution,
      resolutionReason:
        resolution === "sent_back" ? "No ledger correction is required" : null,
      resolvedAt: timestamp,
      resolvedByUserId: POLICY_ID,
      status: resolution === "sent_back" ? "rejected" : "resolved",
    },
  };
}
