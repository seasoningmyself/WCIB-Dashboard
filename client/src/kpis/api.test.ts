import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiClient, ApiRequestOptions } from "../api/client.js";
import { createKpiApi, KpiApiError } from "./api.js";
import { kpiActualsFixture, kpiTargetsFixture, PRODUCER_ID } from "./test-fixture.js";

test("KPI API consumes only its bounded KPI routes with stable UUID scope", async () => {
  const calls: Array<{ options?: ApiRequestOptions; path: string }> = [];
  const targets = kpiTargetsFixture();
  const responses = [
    Response.json(targets),
    Response.json(kpiActualsFixture({
      scope: {
        displayName: "Kaylee Producer",
        producerUserId: PRODUCER_ID,
        scopeType: "producer",
      },
    })),
    Response.json({
      activities: [
        {
          actionType: "policy_approved",
          actorDisplayName: "Sophia Nguyen",
          occurredAt: "2026-07-23T12:00:00.000Z",
          targetReference: "Policy WCIB-1001",
        },
      ],
    }),
    Response.json({ target: targets.items[1] }),
  ];
  const api = createKpiApi({
    async request(path, options) {
      calls.push({ options, path });
      return responses.shift() ?? Response.json({});
    },
  });

  await api.loadTargets(2026);
  await api.loadActuals({
    period: "Q1",
    producerUserId: PRODUCER_ID,
    scopeType: "producer",
    year: 2026,
  });
  await api.loadRecentActivity();
  await api.saveTarget("producer", 2026, {
    newPolicyCountTarget: 7,
    newRevenueTarget: "70000.00",
    producerUserId: PRODUCER_ID,
    retentionRateTarget: "72.50",
  });

  assert.deepEqual(
    calls.map(({ options, path }) => [options?.method, path]),
    [
      ["GET", "/kpi-targets?year=2026"],
      [
        "GET",
        `/kpi-actuals?period=Q1&producerUserId=${PRODUCER_ID}&scopeType=producer&year=2026`,
      ],
      ["GET", "/kpi-activity"],
      ["PUT", "/kpi-targets/producer/2026"],
    ],
  );
  assert.deepEqual(JSON.parse(String(calls[3]?.options?.body)), {
    newPolicyCountTarget: 7,
    newRevenueTarget: "70000.00",
    producerUserId: PRODUCER_ID,
    retentionRateTarget: "72.50",
  });
  assert.equal(
    calls.some(({ path }) => /polic|pay-sheet|rate|localStorage/i.test(path)),
    false,
  );
});

test("KPI API rejects unsafe scope and target input before a request", async () => {
  let requests = 0;
  const api = createKpiApi({
    async request() {
      requests += 1;
      return Response.json({});
    },
  });
  await assert.rejects(
    api.loadActuals({
      period: "Q1",
      producerUserId: PRODUCER_ID,
      scopeType: "company",
      year: 2026,
    } as never),
    rejected,
  );
  await assert.rejects(
    api.saveTarget("company", 2026, {
      newRevenueTarget: "-1.00",
      producerUserId: null,
    } as never),
    rejected,
  );
  assert.equal(requests, 0);
});

test("KPI API normalizes denied, conflict, rejected, network, and response failures", async () => {
  for (const [response, kind] of [
    [new Response(null, { status: 403 }), "denied"],
    [new Response(null, { status: 409 }), "conflict"],
    [new Response(null, { status: 400 }), "rejected"],
    [new Response(null, { status: 500 }), "unavailable"],
    [Response.json({ items: [], producers: [] }), "invalid_response"],
  ] as const) {
    const api = createKpiApi(client(response));
    await assert.rejects(
      api.loadTargets(2026),
      (error: unknown) => error instanceof KpiApiError && error.kind === kind,
    );
  }
  const unavailable = createKpiApi({
    async request() {
      throw new Error("network details stay local");
    },
  });
  await assert.rejects(
    unavailable.loadTargets(2026),
    (error: unknown) =>
      error instanceof KpiApiError && error.kind === "unavailable",
  );
});

function rejected(error: unknown): boolean {
  return error instanceof KpiApiError && error.kind === "rejected";
}

function client(response: Response): ApiClient {
  return { async request() { return response; } };
}
