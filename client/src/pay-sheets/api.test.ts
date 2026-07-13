import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiClient, ApiRequestOptions } from "../api/client.js";
import { createPaySheetsApi, PaySheetsApiError } from "./api.js";
import {
  paySheetDetailFixture,
  paySheetListFixture,
  sophiaSummaryFixture,
  uuid,
} from "./test-fixture.js";

test("pay-sheets API uses only the real data and streamed export routes", async () => {
  const calls: Array<{ options?: ApiRequestOptions; path: string }> = [];
  const detail = paySheetDetailFixture();
  const mutation = (action: "created" | "deleted" | "updated") => ({
    mutation: {
      action,
      adjustmentId: detail.adjustments[0]!.id,
      paySheetId: detail.id,
    },
    sheet:
      action === "deleted"
        ? { ...detail, adjustments: [] }
        : detail,
  });
  const next = sophiaSummaryFixture({
    adjustmentCount: 0,
    closeBlocker: "empty",
    id: uuid(40),
    periodMonth: 8,
    policyCount: 0,
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
  });
  const closed = {
    ...detail,
    closedAt: "2026-07-31T12:00:00.000Z",
    closedByUserId: uuid(1),
    policies: detail.policies.map((policy) => ({ ...policy, source: "frozen" })),
    status: "closed",
  };
  const responses = [
    Response.json(paySheetListFixture()),
    Response.json({ created: true, sheet: next }),
    Response.json({ sheet: detail }),
    Response.json({
      close: {
        closed: true,
        nextSheetId: next.id,
        ownerType: "sophia",
        periodMonth: 7,
        periodYear: 2026,
        policyCount: 1,
      },
      closedSheet: closed,
      nextSheet: next,
    }),
    Response.json(mutation("created")),
    Response.json(mutation("updated")),
    Response.json(mutation("deleted")),
    Response.json({ producers: [] }),
    exportResponse("excel", "WCIB_Pay_Sheets_2026-07.xlsx"),
    exportResponse("print", "WCIB_Pay_Sheet_2026-07.html"),
  ];
  const api = createPaySheetsApi({
    async request(path, options) {
      calls.push({ options, path });
      return responses.shift() ?? Response.json({});
    },
  });

  await api.list();
  await api.bootstrap({ periodMonth: 6, periodYear: 2026 });
  await api.get(detail.id);
  await api.close(detail.id);
  await api.createAdjustment(detail.id, adjustmentInput());
  await api.updateAdjustment(detail.adjustments[0]!.id, adjustmentInput());
  await api.deleteAdjustment(detail.adjustments[0]!.id);
  await api.listAssignmentOptions();
  const excel = await api.exportDocument("excel", {
    ownerUserId: null,
    periodMonth: 7,
    periodYear: 2026,
  });
  const print = await api.exportDocument("print", {
    ownerUserId: uuid(2),
    periodMonth: 7,
    periodYear: 2026,
  });

  assert.deepEqual(
    calls.map(({ options, path }) => [options?.method, path]),
    [
      ["GET", "/pay-sheets?ownerType=all&status=all"],
      ["POST", "/pay-sheets/bootstrap"],
      ["GET", `/pay-sheets/${detail.id}`],
      ["POST", `/pay-sheets/${detail.id}/close`],
      ["POST", `/pay-sheets/${detail.id}/adjustments`],
      ["PUT", `/pay-sheet-adjustments/${detail.adjustments[0]!.id}`],
      ["DELETE", `/pay-sheet-adjustments/${detail.adjustments[0]!.id}`],
      ["GET", "/draft-assignment-options"],
      ["GET", "/pay-sheets/exports/excel?periodMonth=7&periodYear=2026"],
      ["GET", `/pay-sheets/exports/print?periodMonth=7&periodYear=2026&ownerUserId=${uuid(2)}`],
    ],
  );
  assert.equal(excel.filename, "WCIB_Pay_Sheets_2026-07.xlsx");
  assert.equal(excel.blob.size, 4);
  assert.equal(print.filename, "WCIB_Pay_Sheet_2026-07.html");
  assert.equal(print.blob.size, 4);
  assert.equal(calls[8]?.options?.cache, "no-store");
  assert.equal(calls[9]?.options?.cache, "no-store");
  assert.deepEqual(JSON.parse(String(calls[1]?.options?.body)), {
    periodMonth: 6,
    periodYear: 2026,
  });
  assert.deepEqual(JSON.parse(String(calls[3]?.options?.body)), {});
  assert.equal(
    calls.some(({ path }) => /reopen|localStorage/i.test(path)),
    false,
  );
});

test("pay-sheets API rejects unsafe adjustment input before a request", async () => {
  let requests = 0;
  const api = createPaySheetsApi({
    async request() {
      requests += 1;
      return Response.json({});
    },
  });
  await assert.rejects(
    api.createAdjustment(uuid(1), {
      ...adjustmentInput(),
      paySheetId: uuid(99),
    } as never),
    (error: unknown) =>
      error instanceof PaySheetsApiError && error.kind === "rejected",
  );
  assert.equal(requests, 0);
});

test("pay-sheets API rejects unsafe bootstrap input before a request", async () => {
  let requests = 0;
  const api = createPaySheetsApi({
    async request() {
      requests += 1;
      return Response.json({});
    },
  });
  assert.throws(
    () =>
      api.bootstrap({
        actorUserId: uuid(1),
        periodMonth: 6,
        periodYear: 2026,
      } as never),
    isPaySheetsError("rejected"),
  );
  assert.equal(requests, 0);
});

test("pay-sheets export rejects unsafe scope and malformed document headers", async () => {
  let requests = 0;
  const api = createPaySheetsApi({
    async request() {
      requests += 1;
      return new Response("xlsx", {
        headers: {
          "content-disposition": 'attachment; filename="../../unsafe.xlsx"',
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      });
    },
  });
  await assert.rejects(
    api.exportDocument("excel", {
      ownerUserId: "not-a-uuid",
      periodMonth: 7,
      periodYear: 2026,
    }),
    isPaySheetsError("rejected"),
  );
  assert.equal(requests, 0);
  await assert.rejects(
    api.exportDocument("excel", {
      ownerUserId: null,
      periodMonth: 7,
      periodYear: 2026,
    }),
    isPaySheetsError("invalid_response"),
  );
  assert.equal(requests, 1);
});

test("pay-sheets API normalizes denied, conflict, rejected, network, and response failures", async () => {
  for (const [response, kind] of [
    [new Response(null, { status: 403 }), "denied"],
    [new Response(null, { status: 409 }), "conflict"],
    [new Response(null, { status: 400 }), "rejected"],
    [new Response(null, { status: 500 }), "unavailable"],
    [Response.json({ items: [] }), "invalid_response"],
  ] as const) {
    const api = createPaySheetsApi(client(response));
    await assert.rejects(
      api.list(),
      (error: unknown) =>
        error instanceof PaySheetsApiError && error.kind === kind,
    );
  }
  const unavailable = createPaySheetsApi({
    async request() {
      throw new Error("network details remain local");
    },
  });
  await assert.rejects(
    unavailable.list(),
    (error: unknown) =>
      error instanceof PaySheetsApiError && error.kind === "unavailable",
  );
});

function adjustmentInput() {
  return {
    accountBasis: "own" as const,
    adjustmentType: "check_income" as const,
    brokerFeeDelta: "0.00",
    commissionDelta: "0.00",
    effectiveDate: "2026-07-03",
    incomeAmount: "100.00",
    insuredOrClientLabel: "Direct-pay client",
    payoutDelta: "0.00",
    policyTypeId: null,
    producerUserId: null,
    reasonOrNote: "Check received directly",
  };
}

function client(response: Response): ApiClient {
  return { async request() { return response; } };
}

function exportResponse(
  format: "excel" | "print",
  filename: string,
): Response {
  return new Response(format === "excel" ? "xlsx" : "html", {
    headers: {
      "content-disposition": `${format === "excel" ? "attachment" : "inline"}; filename="${filename}"`,
      "content-type": format === "excel"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/html; charset=utf-8",
    },
  });
}

function isPaySheetsError(kind: PaySheetsApiError["kind"]) {
  return (error: unknown) =>
    error instanceof PaySheetsApiError && error.kind === kind;
}
