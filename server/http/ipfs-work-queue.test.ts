import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { test } from "node:test";
import { createApp } from "../app.js";
import type { AccessPrincipal } from "../auth/access.js";
import { createAuthorizationGuards } from "../auth/authorization.js";
import type { UserAccount } from "../auth/users.js";
import type { PolicyRecord } from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import type { IpfsWorkQueueSourceItem } from "../policies/ledger.js";
import { auditRouteAccessDeclarations } from "./routes.js";
import {
  createIpfsWorkQueueHandler,
  IPFS_WORK_QUEUE_EXPORT_PATH,
  registerIpfsWorkQueueRoute,
} from "./ipfs-work-queue.js";

const ADMIN_ID = uuid(1);
const EMPLOYEE_ID = uuid(2);
const PRODUCER_ID = uuid(3);
const INACTIVE_ID = uuid(4);
const GENERATED_AT = new Date("2026-07-14T12:00:00.000Z");

test("admin streams the projected v15 IPFS work queue with safe headers", async () => {
  const fixture = createFixture();
  const running = await startServer(fixture.app);
  try {
    const response = await request(running.baseUrl, "admin");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("pragma"), "no-cache");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("content-type"), "text/csv; charset=utf-8");
    assert.equal(
      response.headers.get("content-disposition"),
      'attachment; filename="WCIB_IPFS_Financed_2026-07-14.csv"',
    );
    const csv = response.body.toString("utf8");
    assert.match(csv, /^\ufeffRecord ID,/);
    assert.match(csv, /Private Insured/);
    assert.doesNotMatch(csv, /must-not-leak|passwordHash/);
    assert.equal(fixture.listCount, 1);
    assert.equal(JSON.stringify(fixture.events).includes("Private Insured"), false);
    assert.equal(JSON.stringify(fixture.events).includes("775.00"), false);
  } finally {
    await stopServer(running.server);
  }
});

test("employee, producer, inactive, and anonymous callers receive no IPFS document", async () => {
  const fixture = createFixture();
  const running = await startServer(fixture.app);
  try {
    for (const identity of [undefined, "employee", "producer", "inactive"] as const) {
      const response = await request(running.baseUrl, identity);
      assert.equal(
        response.status,
        identity === undefined || identity === "inactive" ? 401 : 403,
      );
      assert.equal(response.headers.get("content-disposition"), null);
      assert.doesNotMatch(response.body.toString("utf8"), /Private Insured|775\.00/);
    }
    assert.equal(fixture.listCount, 0);
  } finally {
    await stopServer(running.server);
  }
});

test("an empty IPFS work queue returns a bounded non-document response", async () => {
  const fixture = createFixture(true);
  const running = await startServer(fixture.app);
  try {
    const response = await request(running.baseUrl, "admin");
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("content-disposition"), null);
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.doesNotMatch(response.body.toString("utf8"), /Private Insured|775\.00/);
  } finally {
    await stopServer(running.server);
  }
});

test("IPFS work queue is explicitly admin-only and fails closed without context", async () => {
  const fixture = createFixture();
  const declarations = auditRouteAccessDeclarations(fixture.app).filter(
    ({ path }) => path === IPFS_WORK_QUEUE_EXPORT_PATH,
  );
  assert.deepEqual(
    declarations.map(({ access, method, path }) => ({ method, path, type: access.type })),
    [{ method: "GET", path: IPFS_WORK_QUEUE_EXPORT_PATH, type: "authorized" }],
  );

  let accessed = 0;
  const handler = createIpfsWorkQueueHandler({
    async list() { accessed += 1; return []; },
    logger: silentLogger(),
  });
  const error = await invokeWithoutContext(handler);
  assert.equal(error?.name, "MissingAuthorizationContextError");
  assert.equal(accessed, 0);
});

function createFixture(empty = false) {
  const accounts = new Map<string, UserAccount>([
    [ADMIN_ID, account(ADMIN_ID, true)],
    [EMPLOYEE_ID, account(EMPLOYEE_ID, true)],
    [PRODUCER_ID, account(PRODUCER_ID, true)],
    [INACTIVE_ID, account(INACTIVE_ID, false)],
  ]);
  const principals = new Map<string, AccessPrincipal>([
    [ADMIN_ID, principal(ADMIN_ID, { capabilities: ["admin"] })],
    [EMPLOYEE_ID, principal(EMPLOYEE_ID, { staffRole: "employee" })],
    [PRODUCER_ID, principal(PRODUCER_ID, { staffRole: "producer" })],
    [INACTIVE_ID, principal(INACTIVE_ID, { capabilities: ["admin"], userActive: false })],
  ]);
  const events: Array<{ context?: Record<string, unknown>; message: string }> = [];
  const logger: AppLogger = {
    error(message, context) { events.push({ context, message }); },
    info(message, context) { events.push({ context, message }); },
    warn() {},
  };
  const authorization = createAuthorizationGuards({
    async findUser(id) { return accounts.get(id) ?? null; },
    async loadPrincipal(id) { return principals.get(id) ?? null; },
    logger,
  });
  const fixture = {
    app: null as unknown as ReturnType<typeof createApp>,
    events,
    listCount: 0,
  };
  fixture.app = createApp({
    logUnexpectedError() {},
    registerRoutes(routes) {
      registerIpfsWorkQueueRoute(routes, {
        authorization,
        clock: () => GENERATED_AT,
        async list() {
          fixture.listCount += 1;
          return empty ? [] : [sourceItem()];
        },
        logger,
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
          ? INACTIVE_ID
          : undefined;
  req.session = {
    cookie: {},
    destroy(callback: (error?: unknown) => void) { callback(); },
    sessionVersion: userId === undefined ? undefined : 0,
    userId,
  } as unknown as Request["session"];
  next();
};

function sourceItem(): IpfsWorkQueueSourceItem {
  return {
    labels: {
      carrierName: "Carrier",
      mgaName: "MGA",
      officeName: "Office",
      policyTypeClass: "Commercial",
      policyTypeName: "General Liability",
      producerDisplayName: "Kaylee",
      submitterDisplayName: "Mercedes",
    },
    policy: {
      ...policyRecord(),
      passwordHash: "must-not-leak",
    } as PolicyRecord,
    producerPayout: "52.50",
    sophiaRetained: "122.50",
  };
}

function policyRecord(): PolicyRecord {
  const at = new Date("2026-07-11T12:00:00.000Z");
  return {
    accountAssignment: "book",
    amountPaid: "300.00",
    approvedAt: at,
    balanceDueDate: null,
    basePremium: "1000.00",
    brokerFee: "50.00",
    carrierId: uuid(20),
    collectedToDate: "0.00",
    commissionAmount: "125.00",
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "12.5000",
    companyName: "Private Company",
    createdAt: at,
    deleteReason: null,
    deletedAt: null,
    deletedByUserId: null,
    depositOption: "300.00",
    effectiveDate: "2026-07-01",
    expirationDate: "2027-07-01",
    financeBalance: "775.00",
    financeContact: { address: "10 Main", email: "private@example.test", mobile: "555" },
    financeMeta: { billingType: "invoice", loanType: "commercial", minEarnedAmt: null, minEarnedPct: null },
    financeReference: "IPFS-PRIVATE",
    id: uuid(10),
    insuredName: "Private Insured",
    invoiceNumber: null,
    ipfsFinanced: "yes",
    ipfsManual: false,
    ipfsPushed: false,
    ipfsPushedAt: null,
    ipfsReturning: "new",
    kayleeSplit: "book",
    mgaFee: "25.00",
    mgaId: uuid(21),
    mgaPaid: false,
    mgaPaidAt: null,
    mgaPayReference: null,
    netDue: "175.00",
    netDueTotal: "0.00",
    notes: "Private notes",
    officeLocationId: uuid(22),
    overridden: false,
    payableStatus: "paid",
    paymentMode: "deposit",
    policyNumber: "GL-100",
    policyTypeId: uuid(23),
    premiumTotal: "0.00",
    producerCommissionReceivedAt: null,
    producerUserId: PRODUCER_ID,
    proposalTotal: "1075.00",
    receivableStatus: "paid",
    remittedToMga: "0.00",
    sourceDraftId: null,
    submittedAt: at,
    submittedByUserId: EMPLOYEE_ID,
    taxes: "0.00",
    transactionNotes: null,
    transactionType: "New",
    updatedAt: at,
  };
}

async function request(
  baseUrl: string,
  identity?: "admin" | "employee" | "inactive" | "producer",
) {
  const response = await fetch(`${baseUrl}${IPFS_WORK_QUEUE_EXPORT_PATH}`, {
    headers: identity === undefined ? {} : { "x-test-identity": identity },
  });
  return {
    body: Buffer.from(await response.arrayBuffer()),
    headers: response.headers,
    status: response.status,
  };
}

async function startServer(app: ReturnType<typeof createApp>) {
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
  const req = {} as Request;
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

function silentLogger(): AppLogger {
  return { error() {}, info() {}, warn() {} };
}

function uuid(suffix: number): string {
  return `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}
