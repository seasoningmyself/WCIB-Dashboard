import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiClient, ApiRequestOptions } from "../api/client.js";
import { createDraftApi, DraftApiError } from "./api.js";

const DRAFT_ID = "00000000-0000-4000-8000-000000000101";
const USER_ID = "00000000-0000-4000-8000-000000000102";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000103";
const POLICY_ID = "00000000-0000-4000-8000-000000000104";
const CHANGE_REQUEST_ID = "00000000-0000-4000-8000-000000000105";

test("draft API uses documented create, edit, flag, withdrawal, list, submit, and assignment paths", async () => {
  const calls: Array<{
    options?: ApiRequestOptions;
    path: string;
  }> = [];
  const responses = [
    new Response(JSON.stringify({ draft: draftResponse() }), {
      headers: { "Content-Type": "application/json" },
      status: 201,
    }),
    Response.json({ draft: draftResponse() }),
    Response.json({ draft: draftResponse() }),
    Response.json({ draft: draftResponse({ status: "flagged" }) }),
    Response.json({ draft: draftResponse() }),
    Response.json({
      destination: "approval",
      draft: draftResponse({ status: "submitted" }),
    }),
    Response.json({ drafts: [draftResponse()] }),
    Response.json({
      producers: [{ displayName: "Kaylee", userId: PRODUCER_ID }],
    }),
    Response.json({ request: changeRequestResponse() }, { status: 201 }),
    Response.json({ requests: [changeRequestResponse()] }),
  ];
  const client: ApiClient = {
    async request(path, options) {
      calls.push({ options, path });
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
  };
  const api = createDraftApi(client);

  await api.create({ insuredName: "  Acme LLC  ", taxes: "4.5" });
  await api.edit(DRAFT_ID, { notes: "Updated" });
  await api.flag(DRAFT_ID, { reason: "  Need MGA help  " });
  await api.withdrawHelp(DRAFT_ID);
  await api.withdrawSubmission(DRAFT_ID);
  await api.submit(DRAFT_ID);
  assert.equal((await api.list()).drafts.length, 1);
  assert.deepEqual(await api.listAssignmentOptions(), {
    producers: [{ displayName: "Kaylee", userId: PRODUCER_ID }],
  });
  await api.createChangeRequest(POLICY_ID, {
    reason: "  Please review the insured name.  ",
  });
  assert.equal((await api.listChangeRequests()).requests.length, 1);

  assert.equal(calls[0]?.path, "/drafts");
  assert.equal(calls[0]?.options?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0]?.options?.body)), {
    insuredName: "Acme LLC",
    taxes: "4.50",
  });
  assert.equal(calls[1]?.path, `/drafts/${DRAFT_ID}`);
  assert.equal(calls[1]?.options?.method, "PATCH");
  assert.equal(calls[2]?.path, `/drafts/${DRAFT_ID}/flag`);
  assert.equal(calls[2]?.options?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[2]?.options?.body)), {
    reason: "Need MGA help",
  });
  assert.equal(calls[3]?.path, `/drafts/${DRAFT_ID}/withdraw-help`);
  assert.equal(calls[3]?.options?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[3]?.options?.body)), {});
  assert.equal(calls[4]?.path, `/drafts/${DRAFT_ID}/withdraw-submission`);
  assert.equal(calls[4]?.options?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[4]?.options?.body)), {});
  assert.equal(calls[5]?.path, `/drafts/${DRAFT_ID}/submit`);
  assert.equal(calls[5]?.options?.method, "POST");
  assert.equal(calls[6]?.path, "/drafts");
  assert.equal(calls[6]?.options?.method, "GET");
  assert.equal(calls[6]?.options?.cache, "no-store");
  assert.equal(calls[7]?.path, "/draft-assignment-options");
  assert.equal(calls[7]?.options?.cache, "no-store");
  assert.equal(calls[8]?.path, `/policies/${POLICY_ID}/change-requests`);
  assert.equal(calls[8]?.options?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[8]?.options?.body)), {
    reason: "Please review the insured name.",
  });
  assert.equal(calls[9]?.path, "/policy-change-requests/mine");
  assert.equal(calls[9]?.options?.cache, "no-store");
});

test("draft API normalizes input, network, status, and response failures", async () => {
  const invalidInputApi = createDraftApi({
    async request() {
      throw new Error("must not run");
    },
  });
  await assert.rejects(
    invalidInputApi.create({ taxes: "not-money" } as never),
    (error: unknown) =>
      error instanceof DraftApiError &&
      error.kind === "rejected" &&
      error.details[0]?.field === "taxes" &&
      error.message === "Draft request could not be completed",
  );
  await assert.rejects(
    invalidInputApi.list({ ownerUserId: USER_ID } as never),
    (error: unknown) =>
      error instanceof DraftApiError && error.kind === "rejected",
  );
  await assert.rejects(
    invalidInputApi.flag(DRAFT_ID, { reason: "" }),
    (error: unknown) =>
      error instanceof DraftApiError && error.kind === "rejected",
  );
  await assert.rejects(
    invalidInputApi.createChangeRequest(POLICY_ID, {
      reason: "",
    }),
    (error: unknown) =>
      error instanceof DraftApiError && error.kind === "rejected",
  );

  for (const client of [
    { async request() { throw new Error("private network detail"); } },
    { async request() { return new Response(null, { status: 500 }); } },
    { async request() { return new Response("not-json"); } },
    { async request() { return Response.json({ draft: { id: "bad" } }); } },
  ] satisfies ApiClient[]) {
    await assert.rejects(createDraftApi(client).edit(DRAFT_ID, { notes: "x" }), DraftApiError);
  }

  await assert.rejects(
    createDraftApi({
      async request() {
        return new Response(null, { status: 409 });
      },
    }).flag(DRAFT_ID, { reason: "Need help" }),
    (error: unknown) =>
      error instanceof DraftApiError &&
      error.kind === "conflict" &&
      error.message === "Draft request could not be completed",
  );
  await assert.rejects(
    createDraftApi({
      async request() {
        return new Response(null, { status: 409 });
      },
    }).withdrawHelp(DRAFT_ID),
    (error: unknown) =>
      error instanceof DraftApiError && error.kind === "conflict",
  );
  await assert.rejects(
    createDraftApi({
      async request() {
        return new Response(null, { status: 409 });
      },
    }).withdrawSubmission(DRAFT_ID),
    (error: unknown) =>
      error instanceof DraftApiError && error.kind === "conflict",
  );
});

function draftResponse(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    accountAssignment: "book",
    carrierId: null,
    companyName: null,
    createdAt: "2026-07-10T12:00:00.000Z",
    effectiveDate: null,
    expirationDate: null,
    flagReason: null,
    history: [],
    id: DRAFT_ID,
    insuredName: "Acme LLC",
    invoiceNumber: null,
    lastEditedAt: "2026-07-10T12:00:00.000Z",
    linkedPolicyId: null,
    linkedQueueEntryId: null,
    mgaId: null,
    notes: null,
    officeLocationId: null,
    ownerUserId: USER_ID,
    policyNumber: null,
    policyTypeId: null,
    producerUserId: PRODUCER_ID,
    schemaVersion: 1,
    sentBackAt: null,
    sentBackByUserId: null,
    sentBackReason: null,
    status: "draft",
    submittedAt: null,
    transactionNotes: null,
    transactionType: null,
    ...overrides,
  };
}

function changeRequestResponse() {
  return {
    id: CHANGE_REQUEST_ID,
    policyId: POLICY_ID,
    reason: "Please review the insured name.",
    requestedAt: "2026-07-14T12:00:00.000Z",
    resolution: null,
    resolutionReason: null,
    resolvedAt: null,
    status: "pending",
  };
}
