import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiClient, ApiRequestOptions } from "../api/client.js";
import {
  createSingleFlightRunner,
  createVocabularyMutationApi,
  VocabularyMutationApiError,
} from "./mutation-api.js";

const ID = "00000000-0000-4000-8000-000000000001";

test("vocabulary mutations use protected endpoints and retain only safe DTO fields", async () => {
  const requests: Array<{
    options?: ApiRequestOptions;
    path: string;
  }> = [];
  const responses = [
    Response.json(
      {
        item: { auditTrail: ["private"], id: ID, name: "Travelers" },
        outcome: "duplicate",
      },
      { status: 409 },
    ),
    Response.json(
      {
        item: {
          classTag: "Commercial",
          id: ID,
          name: "General Liability",
          premiumTotal: "1000.00",
        },
        outcome: "created",
      },
      { status: 201 },
    ),
    Response.json(
      {
        candidates: [{ id: ID, name: "RPS", policyCount: 20 }],
        outcome: "confirmation_required",
      },
      { status: 409 },
    ),
    Response.json(
      {
        item: { id: ID, name: "RPT" },
        outcome: "created",
      },
      { status: 201 },
    ),
  ];
  const client: ApiClient = {
    async request(path, options) {
      requests.push({ options, path });
      const response = responses.shift();
      assert.ok(response);
      return response;
    },
  };
  const api = createVocabularyMutationApi(client);

  assert.deepEqual(await api.createCarrier({ name: "Travelers" }), {
    item: { id: ID, name: "Travelers" },
    outcome: "duplicate",
  });
  assert.deepEqual(
    await api.createPolicyType({
      classTag: "Commercial",
      name: "General Liability",
    }),
    {
      item: { classTag: "Commercial", id: ID, name: "General Liability" },
      outcome: "created",
    },
  );
  assert.deepEqual(
    await api.createMga({ confirmNearDuplicate: false, name: "RPT" }),
    {
      candidates: [{ id: ID, name: "RPS" }],
      outcome: "confirmation_required",
    },
  );
  assert.deepEqual(
    await api.createMga({ confirmNearDuplicate: true, name: "RPT" }),
    {
      item: { id: ID, name: "RPT" },
      outcome: "created",
    },
  );
  assert.deepEqual(
    requests.map(({ path }) => path),
    [
      "/vocabulary/carriers",
      "/vocabulary/policy-types",
      "/vocabulary/mgas",
      "/vocabulary/mgas",
    ],
  );
  assert.equal(requests.every(({ options }) => options?.method === "POST"), true);
  assert.deepEqual(JSON.parse(String(requests[2]?.options?.body)), {
    confirmNearDuplicate: false,
    name: "RPT",
  });
  assert.deepEqual(JSON.parse(String(requests[3]?.options?.body)), {
    confirmNearDuplicate: true,
    name: "RPT",
  });
});

test("vocabulary mutations fail safely for denied and inconsistent responses", async () => {
  const clients = [
    { async request() { throw new Error("private network detail"); } },
    responseClient(new Response(null, { status: 401 })),
    responseClient(new Response(null, { status: 403 })),
    responseClient(
      Response.json(
        { item: { id: ID, name: "Carrier" }, outcome: "created" },
        { status: 409 },
      ),
    ),
    responseClient(
      Response.json(
        { item: { id: "bad", name: "Carrier" }, outcome: "created" },
        { status: 201 },
      ),
    ),
  ];
  const expectedKinds = [
    "unavailable",
    "unavailable",
    "forbidden",
    "invalid_response",
    "invalid_response",
  ];
  for (const [index, client] of clients.entries()) {
    await assert.rejects(
      createVocabularyMutationApi(client).createCarrier({ name: "Carrier" }),
      (error: unknown) =>
        error instanceof VocabularyMutationApiError &&
        error.kind === expectedKinds[index],
    );
  }
});

test("vocabulary mutations reject invalid input before making a request", async () => {
  let calls = 0;
  const api = createVocabularyMutationApi({
    async request() {
      calls += 1;
      return new Response(null, { status: 500 });
    },
  });

  await assert.rejects(
    api.createCarrier({ name: "   " }),
    (error: unknown) =>
      error instanceof VocabularyMutationApiError &&
      error.kind === "rejected",
  );
  assert.equal(calls, 0);
});

test("single-flight runner suppresses a duplicate pending mutation", async () => {
  const pendingChanges: boolean[] = [];
  const runner = createSingleFlightRunner((pending) =>
    pendingChanges.push(pending),
  );
  let release: (value: string) => void = () => undefined;
  let calls = 0;
  const first = runner.run(
    () =>
      new Promise<string>((resolve) => {
        calls += 1;
        release = resolve;
      }),
  );
  const second = await runner.run(async () => {
    calls += 1;
    return "duplicate";
  });

  assert.deepEqual(second, { started: false });
  assert.equal(calls, 1);
  assert.equal(runner.isPending(), true);
  release("created");
  assert.deepEqual(await first, { result: "created", started: true });
  assert.deepEqual(pendingChanges, [true, false]);
  assert.equal(runner.isPending(), false);
});

function responseClient(response: Response): ApiClient {
  return { async request() { return response; } };
}
