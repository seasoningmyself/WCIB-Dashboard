import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiClient } from "../api/client.js";
import {
  createPolicyLedgerApi,
  PolicyLedgerApiError,
} from "./api.js";
import {
  ledgerItemFixture,
  ledgerListFixture,
  uuid,
} from "./test-fixture.js";

test("policy ledger API uses the real list, detail, assignment, and correction paths", async () => {
  const calls: Array<{ options: RequestInit | undefined; path: string }> = [];
  const item = ledgerItemFixture();
  const deletedItem = {
    deletion: {
      deletedAt: "2026-07-12T12:00:00.000Z",
      deletedByUserId: uuid(1),
      reason: "Duplicate entry",
    },
    labels: item.labels,
    policy: item.policy,
  };
  const responses = [
    Response.json(ledgerListFixture()),
    Response.json({ item }),
    Response.json({
      producers: [
        {
          bookEnabled: true,
          displayName: "Kaylee",
          firstYearEnabled: true,
          userId: uuid(5),
        },
      ],
    }),
    Response.json({ policy: item.policy }),
    Response.json({ items: [deletedItem] }),
    Response.json({ changed: true, detachedOpenSheetCount: 2, item: deletedItem }),
    Response.json({ changed: true, item }),
    Response.json({ changed: true, item }),
    new Response("\ufeffRecord ID\r\n1", {
      headers: {
        "content-disposition": 'attachment; filename="WCIB_IPFS_Financed_2026-07-14.csv"',
        "content-type": "text/csv; charset=utf-8",
      },
    }),
  ];
  const api = createPolicyLedgerApi({
    async request(path, options) {
      calls.push({ options, path });
      return responses.shift() ?? Response.json({});
    },
  });

  await api.list({
    direction: "asc",
    duplicates: "only",
    finance: "ipfs_pending",
    limit: 50,
    month: "2026-07",
    offset: 100,
    search: "Acme & Sons",
    sort: "insured",
  });
  await api.get(uuid(10));
  await api.listAssignmentOptions();
  const kind = await api.correct(uuid(10), {
    change: {
      changedFields: ["insuredName"],
      reason: "Correct insured",
      replacementValues: { insuredName: "Corrected Insured" },
    },
    expectedUpdatedAt: "2026-07-11T12:00:00.000Z",
    kind: "general",
  });
  assert.equal(kind, "general");
  await api.listDeleted();
  await api.softDelete(uuid(10), {
    expectedUpdatedAt: "2026-07-11T12:00:00.000Z",
    reason: "Duplicate entry",
  });
  await api.restore(uuid(10), {
    expectedUpdatedAt: "2026-07-12T12:00:00.000Z",
  });
  const pushed = await api.setIpfsPushed(uuid(10), {
    expectedUpdatedAt: "2026-07-11T12:00:00.000Z",
    pushed: true,
  });
  assert.equal(pushed.changed, true);
  const csv = await api.downloadIpfsWorkQueue();
  assert.equal(csv.filename, "WCIB_IPFS_Financed_2026-07-14.csv");
  assert.equal(await csv.blob.text(), "Record ID\r\n1");
  assert.equal(
    calls[0]?.path,
    "/policies?duplicates=only&finance=ipfs_pending&limit=50&offset=100&search=Acme+%26+Sons&sort=insured&direction=asc&month=2026-07",
  );
  assert.equal(calls[0]?.options?.method, "GET");
  assert.equal(calls[1]?.path, `/policies/${uuid(10)}`);
  assert.equal(calls[2]?.path, "/draft-assignment-options");
  assert.equal(calls[3]?.path, `/policies/${uuid(10)}/correction`);
  assert.equal(calls[3]?.options?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(calls[3]?.options?.body)), {
    change: {
      changedFields: ["insuredName"],
      reason: "Correct insured",
      replacementValues: { insuredName: "Corrected Insured" },
    },
    expectedUpdatedAt: "2026-07-11T12:00:00.000Z",
    kind: "general",
  });
  assert.equal(calls[4]?.path, "/deleted-policies");
  assert.equal(calls[4]?.options?.method, "GET");
  assert.equal(calls[5]?.path, `/policies/${uuid(10)}/soft-delete`);
  assert.equal(calls[5]?.options?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[5]?.options?.body)), {
    expectedUpdatedAt: "2026-07-11T12:00:00.000Z",
    reason: "Duplicate entry",
  });
  assert.equal(calls[6]?.path, `/deleted-policies/${uuid(10)}/restore`);
  assert.equal(calls[6]?.options?.method, "POST");
  assert.equal(calls[7]?.path, `/policies/${uuid(10)}/ipfs-pushed`);
  assert.equal(calls[7]?.options?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(calls[7]?.options?.body)), {
    expectedUpdatedAt: "2026-07-11T12:00:00.000Z",
    pushed: true,
  });
  assert.equal(calls[8]?.path, "/ipfs/work-queue.csv");
  assert.equal(calls[8]?.options?.method, "GET");
  assert.equal(
    (calls[8]?.options?.headers as Record<string, string>)?.Accept,
    "text/csv",
  );
});

test("policy ledger API rejects invalid input before a request", async () => {
  let requests = 0;
  const api = createPolicyLedgerApi({
    async request() {
      requests += 1;
      return Response.json({});
    },
  });
  await assert.rejects(
    api.list({ limit: 500 }),
    (error: unknown) =>
      error instanceof PolicyLedgerApiError && error.kind === "rejected",
  );
  await assert.rejects(
    api.correct(uuid(10), {
      change: {
        changedFields: ["brokerFee"],
        reason: "Mixed path",
        replacementValues: { brokerFee: "20.00" },
      },
      expectedUpdatedAt: "2026-07-11T12:00:00.000Z",
      kind: "general",
    } as never),
    (error: unknown) =>
      error instanceof PolicyLedgerApiError && error.kind === "rejected",
  );
  await assert.rejects(
    api.setIpfsPushed(uuid(10), {
      expectedUpdatedAt: "not-a-timestamp",
      pushed: true,
    }),
    (error: unknown) =>
      error instanceof PolicyLedgerApiError && error.kind === "rejected",
  );
  assert.equal(requests, 0);
});

test("policy ledger API normalizes denied, conflict, rejected, network, and response failures", async () => {
  for (const [response, kind] of [
    [new Response(null, { status: 403 }), "denied"],
    [new Response(null, { status: 409 }), "conflict"],
    [new Response(null, { status: 400 }), "rejected"],
    [new Response(null, { status: 500 }), "unavailable"],
    [Response.json({ items: [] }), "invalid_response"],
  ] as const) {
    const api = createPolicyLedgerApi(client(response));
    await assert.rejects(
      api.list({}),
      (error: unknown) =>
        error instanceof PolicyLedgerApiError && error.kind === kind,
    );
  }
  const unavailable = createPolicyLedgerApi({
    async request() {
      throw new Error("network details must remain local");
    },
  });
  await assert.rejects(
    unavailable.list({}),
    (error: unknown) =>
      error instanceof PolicyLedgerApiError && error.kind === "unavailable",
  );
});

function client(response: Response): ApiClient {
  return { async request() { return response; } };
}
