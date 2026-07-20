import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Writable } from "node:stream";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { createApp } from "../app.js";
import type { AccessPrincipal } from "../auth/access.js";
import { createAuthorizationGuards } from "../auth/authorization.js";
import type { UserAccount } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import { buildPaySheetExportModel } from "../pay-sheets/export-document.js";
import {
  exportDetailFixture,
  exportProducerSummary,
  exportSourceFixture,
  exportSophiaSummary,
  uuid,
} from "../pay-sheets/export-test-fixture.js";
import type { PaySheetSourceList } from "../pay-sheets/read.js";
import {
  auditRouteAccessDeclarations,
  type RouteAccessDeclaration,
  type RouteRegistrar,
} from "./routes.js";
import {
  createPaySheetExportHandler,
  PAY_SHEET_EXCEL_EXPORT_PATH,
  PAY_SHEET_PRINT_EXPORT_PATH,
  registerPaySheetExportRoutes,
  streamExcelResponse,
} from "./pay-sheet-exports.js";

const ADMIN_ID = uuid(1);
const PRODUCER_ID = uuid(2);
const EMPLOYEE_ID = uuid(3);
const GENERATED_AT = new Date("2026-07-12T12:00:00.000Z");

interface LoggedEvent {
  context?: Record<string, unknown>;
  level: "error" | "info";
  message: string;
}

test("admin streams full and single-owner Excel plus print-safe HTML", async () => {
  const fixture = createFixture();
  const running = await startServer(fixture.app);
  try {
    const excel = await request(running.baseUrl, PAY_SHEET_EXCEL_EXPORT_PATH, "admin");
    assert.equal(excel.status, 200);
    assert.equal(excel.headers.get("cache-control"), "no-store");
    assert.equal(excel.headers.get("pragma"), "no-cache");
    assert.equal(excel.headers.get("x-content-type-options"), "nosniff");
    assert.equal(
      excel.headers.get("content-type"),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    assert.equal(
      excel.headers.get("content-disposition"),
      'attachment; filename="WCIB_Pay_Sheets_2026-07.xlsx"',
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(excel.body);
    assert.deepEqual(workbook.worksheets.map(({ name }) => name), [
      "Agency Summary",
      "KPI Activity",
      "Sophia",
      "Kaylee",
    ]);

    const single = await request(
      running.baseUrl,
      PAY_SHEET_EXCEL_EXPORT_PATH,
      "admin",
      `&ownerUserId=${PRODUCER_ID}`,
    );
    const singleWorkbook = new ExcelJS.Workbook();
    await singleWorkbook.xlsx.load(single.body);
    assert.deepEqual(singleWorkbook.worksheets.map(({ name }) => name), [
      "Agency Summary",
      "KPI Activity",
      "Kaylee",
    ]);
    assert.equal(
      single.headers.get("content-disposition"),
      'attachment; filename="WCIB_Pay_Sheet_2026-07.xlsx"',
    );

    const print = await request(running.baseUrl, PAY_SHEET_PRINT_EXPORT_PATH, "admin");
    assert.equal(print.status, 200);
    assert.equal(print.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(
      print.headers.get("content-disposition"),
      'inline; filename="WCIB_Pay_Sheets_2026-07.html"',
    );
    assert.match(print.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    const html = print.body.toString("utf8");
    assert.match(html, /Sophia agency gross/);
    assert.match(html, /Sophia take-home/);
    assert.match(html, /Kaylee/);
    assert.doesNotMatch(html, /<script/i);

    assert.deepEqual(
      fixture.observedQueries,
      [
        expectedListQuery(null),
        expectedListQuery(PRODUCER_ID),
        expectedListQuery(null),
      ],
    );
    assert.equal(
      fixture.events.filter(({ message }) => message === "Pay-sheet export streamed").length,
      3,
    );
    assert.equal(
      fixture.events.every(({ context }) =>
        typeof context?.durationMs === "number" && context.durationMs >= 0
      ),
      true,
    );
    assert.equal(
      JSON.stringify(fixture.events).includes("Acme Construction"),
      false,
    );
    assert.equal(JSON.stringify(fixture.events).includes("250.00"), false);
  } finally {
    await stopServer(running.server);
  }
});

test("Excel stream closes resources when the response destination disconnects", async () => {
  const model = buildPaySheetExportModel(
    [exportDetailFixture(exportSophiaSummary())],
    { ownerUserId: null, periodMonth: 7, periodYear: 2026 },
    GENERATED_AT,
  );
  const disconnected = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error("client disconnected"));
    },
  });

  await assert.rejects(
    streamExcelResponse(disconnected as unknown as Response, model),
    /client disconnected/,
  );
  assert.equal(disconnected.destroyed, true);
});

test("employee, producer, inactive, and anonymous callers receive no document", async () => {
  const fixture = createFixture();
  const running = await startServer(fixture.app);
  try {
    for (const identity of [undefined, "employee", "producer", "inactive"] as const) {
      for (const path of [PAY_SHEET_EXCEL_EXPORT_PATH, PAY_SHEET_PRINT_EXPORT_PATH]) {
        const response = await request(running.baseUrl, path, identity);
        assert.equal(
          response.status,
          identity === undefined || identity === "inactive" ? 401 : 403,
        );
        assert.equal(response.headers.get("content-disposition"), null);
        assert.doesNotMatch(response.body.toString("utf8"), /PK\u0003\u0004|Sophia|Kaylee|Acme/);
      }
    }
    assert.equal(fixture.observedQueries.length, 0);
    assert.equal(fixture.events.length, 0);
  } finally {
    await stopServer(running.server);
  }
});

test("invalid, empty, and failed exports return safe non-document responses", async () => {
  const fixture = createFixture();
  const running = await startServer(fixture.app);
  try {
    const invalid = await request(
      running.baseUrl,
      PAY_SHEET_EXCEL_EXPORT_PATH,
      "admin",
      "&periodMonth=13",
      false,
    );
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.get("content-disposition"), null);

    fixture.empty = true;
    const empty = await request(running.baseUrl, PAY_SHEET_PRINT_EXPORT_PATH, "admin");
    assert.equal(empty.status, 404);
    assert.equal(empty.headers.get("content-disposition"), null);
  } finally {
    await stopServer(running.server);
  }

  const failed = createFixture({
    async streamExcel() {
      throw new Error("document content must never enter the response or log");
    },
  });
  const failedServer = await startServer(failed.app);
  try {
    const response = await request(failedServer.baseUrl, PAY_SHEET_EXCEL_EXPORT_PATH, "admin");
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("content-disposition"), null);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(
      JSON.stringify(failed.events).includes("document content must never enter"),
      false,
    );
    assert.equal(failed.events.some(({ message }) => message === "Pay-sheet export failed"), true);
  } finally {
    await stopServer(failedServer.server);
  }
});

test("both export routes are explicitly admin-only and handlers fail closed alone", async () => {
  const fixture = createFixture();
  const declarations = auditRouteAccessDeclarations(fixture.app).filter(
    ({ path }) => path === PAY_SHEET_EXCEL_EXPORT_PATH || path === PAY_SHEET_PRINT_EXPORT_PATH,
  );
  assert.deepEqual(
    declarations.map(({ method, path }) => `${method} ${path}`),
    [`GET ${PAY_SHEET_EXCEL_EXPORT_PATH}`, `GET ${PAY_SHEET_PRINT_EXPORT_PATH}`],
  );
  assert.equal(declarations.every(({ access }) => access.type === "authorized"), true);

  let accessed = 0;
  const handler = createPaySheetExportHandler(
    {
      async list() {
        accessed += 1;
        throw new Error("must not run");
      },
      logger: silentLogger(),
    },
    "excel",
  );
  const error = await invokeWithoutContext(handler);
  assert.equal(error?.name, "MissingAuthorizationContextError");
  assert.equal(accessed, 0);

  const registrations: RouteAccessDeclaration[] = [];
  const routes = Object.fromEntries(
    ["delete", "get", "head", "options", "patch", "post", "put"].map((method) => [
      method,
      (_path: string, access: RouteAccessDeclaration) => registrations.push(access),
    ]),
  ) as unknown as RouteRegistrar;
  registerPaySheetExportRoutes(routes, {
    authorization: createAuthorizationGuards({
      async findUser() { return null; },
      async loadPrincipal() { return null; },
      logger: silentLogger(),
    }),
    async list() { throw new Error("must not run"); },
    logger: silentLogger(),
  });
  assert.equal(registrations.length, 2);
  assert.equal(registrations.every((access) => "authorization" in access), true);
});

function createFixture(
  overrides: { streamExcel?: () => Promise<number> } = {},
) {
  const sophia = exportSourceFixture(exportDetailFixture(exportSophiaSummary()));
  const producer = exportSourceFixture(exportDetailFixture(exportProducerSummary()));
  const accounts = new Map<string, UserAccount>([
    [ADMIN_ID, account(ADMIN_ID, true)],
    [EMPLOYEE_ID, account(EMPLOYEE_ID, true)],
    [PRODUCER_ID, account(PRODUCER_ID, true)],
    [uuid(4), account(uuid(4), false)],
  ]);
  const principals = new Map<string, AccessPrincipal>([
    [ADMIN_ID, principal(ADMIN_ID, { capabilities: ["admin"] })],
    [EMPLOYEE_ID, principal(EMPLOYEE_ID, { staffRole: "employee" })],
    [PRODUCER_ID, principal(PRODUCER_ID, { staffRole: "producer" })],
    [uuid(4), principal(uuid(4), { capabilities: ["admin"], userActive: false })],
  ]);
  const events: LoggedEvent[] = [];
  const logger: AppLogger = {
    error(message, context) { events.push({ context, level: "error", message }); },
    info(message, context) { events.push({ context, level: "info", message }); },
    warn() {},
  };
  const authorization = createAuthorizationGuards({
    async findUser(id) { return accounts.get(id) ?? null; },
    async loadPrincipal(id) { return principals.get(id) ?? null; },
    logger,
  });
  const observedQueries: unknown[] = [];
  const fixture = {
    app: null as unknown as ReturnType<typeof createApp>,
    empty: false,
    events,
    observedQueries,
  };
  fixture.app = createApp({
    logUnexpectedError() {},
    registerRoutes(routes) {
      registerPaySheetExportRoutes(routes, {
        authorization,
        clock: () => GENERATED_AT,
        async list(_context, rawQuery) {
          observedQueries.push(rawQuery);
          const query = rawQuery as ReturnType<typeof expectedListQuery>;
          const items = fixture.empty
            ? []
            : [sophia, producer].filter(
                (source) => query.ownerUserId === null || source.header.sheet.ownerUserId === query.ownerUserId,
              );
          return { items, query } as PaySheetSourceList;
        },
        logger,
        streamExcel: overrides.streamExcel,
      });
    },
    sessionMiddleware: testSessionMiddleware,
  });
  return fixture;
}

const testSessionMiddleware: RequestHandler = (req, _res, next) => {
  const identity = req.headers["x-test-identity"];
  const userId = identity === "admin"
    ? ADMIN_ID
    : identity === "employee"
      ? EMPLOYEE_ID
      : identity === "producer"
        ? PRODUCER_ID
        : identity === "inactive"
          ? uuid(4)
          : undefined;
  req.session = {
    cookie: {},
    destroy(callback: (error?: unknown) => void) { callback(); },
    sessionVersion: userId === undefined ? undefined : 0,
    userId,
  } as unknown as Request["session"];
  next();
};

function account(id: string, isActive: boolean): UserAccount {
  return {
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    displayName: id,
    email: `${id}@example.test`,
    id,
    isActive,
    passwordChangeRequiredAt: null,
    sessionVersion: 0,
  };
}

function principal(id: string, overrides: Partial<AccessPrincipal>): AccessPrincipal {
  return { capabilities: [], staffRole: null, userActive: true, userId: id, ...overrides };
}

function expectedListQuery(ownerUserId: string | null) {
  return {
    ownerType: "all" as const,
    ownerUserId,
    periodMonth: 7,
    periodYear: 2026,
    status: "all" as const,
  };
}

async function request(
  baseUrl: string,
  path: string,
  identity?: "admin" | "employee" | "inactive" | "producer",
  suffix = "",
  defaults = true,
) {
  const query = defaults ? "?periodMonth=7&periodYear=2026" : "?periodYear=2026";
  const response = await fetch(`${baseUrl}${path}${query}${suffix}`, {
    headers: identity === undefined ? {} : { "x-test-identity": identity },
  });
  return {
    body: Buffer.from(await response.arrayBuffer()),
    headers: response.headers,
    status: response.status,
  };
}

async function startServer(app: ReturnType<typeof createApp>): Promise<{ baseUrl: string; server: Server }> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, server };
}

async function stopServer(server: Server): Promise<void> {
  server.close();
  await once(server, "close");
}

async function invokeWithoutContext(handler: RequestHandler): Promise<Error | undefined> {
  const req = { query: { periodMonth: "7", periodYear: "2026" } } as unknown as Request;
  const res = { locals: {} } as Response;
  return new Promise((resolve, reject) => {
    const next: NextFunction = (error?: unknown) => {
      if (error === undefined) resolve(undefined);
      else if (error instanceof Error) resolve(error);
      else reject(error);
    };
    handler(req, res, next);
  });
}

function silentLogger(): AppLogger {
  return { error() {}, info() {}, warn() {} };
}
