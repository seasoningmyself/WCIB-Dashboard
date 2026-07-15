import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import type { AccessPrincipal } from "../auth/access.js";
import { createAuthorizationGuards } from "../auth/authorization.js";
import type { UserAccount } from "../auth/users.js";
import type { PolicyRecord } from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import type { MgaPayableSourceItem } from "../policies/mga-payables.js";
import { toErrorResponse } from "./errors.js";
import {
  MGA_PAYABLES_PATH,
  registerMgaPayableRoute,
  type RegisterMgaPayableRouteOptions,
} from "./mga-payables.js";
import type {
  RouteAccessDeclaration,
  RouteRegistrar,
} from "./routes.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000002";
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000003";
const INACTIVE_ID = "00000000-0000-4000-8000-000000000004";
const POLICY_ID = "00000000-0000-4000-8000-000000000010";
const MGA_ID = "00000000-0000-4000-8000-000000000011";

const logger: AppLogger = { error() {}, info() {}, warn() {} };

interface Registration {
  access: RouteAccessDeclaration;
  handler: RequestHandler;
  path: string;
}

function createFixture() {
  const users = new Map<string, UserAccount>([
    [ADMIN_ID, account(ADMIN_ID)],
    [PRODUCER_ID, account(PRODUCER_ID)],
    [EMPLOYEE_ID, account(EMPLOYEE_ID)],
    [INACTIVE_ID, account(INACTIVE_ID, false)],
  ]);
  const principals = new Map<string, AccessPrincipal>([
    [ADMIN_ID, principal(ADMIN_ID, { capabilities: ["admin"] })],
    [PRODUCER_ID, principal(PRODUCER_ID, { staffRole: "producer" })],
    [EMPLOYEE_ID, principal(EMPLOYEE_ID, { staffRole: "employee" })],
    [
      INACTIVE_ID,
      principal(INACTIVE_ID, { staffRole: "employee", userActive: false }),
    ],
  ]);
  const authorization = createAuthorizationGuards({
    async findUser(userId) {
      return users.get(userId) ?? null;
    },
    async loadPrincipal(userId) {
      return principals.get(userId) ?? null;
    },
    logger,
  });
  const calls: Array<{ query: unknown; userId: string }> = [];
  const registrations: Registration[] = [];
  const options: RegisterMgaPayableRouteOptions = {
    authorization,
    async list(context, query) {
      calls.push({ query, userId: context.principal.userId });
      return { items: [sourceItem()], status: "unpaid" };
    },
    logger,
  };
  const routes = {
    get(
      path: string,
      access: RouteAccessDeclaration,
      ...handlers: RequestHandler[]
    ) {
      assert.ok(handlers[0]);
      registrations.push({ access, handler: handlers[0], path });
    },
  } as unknown as RouteRegistrar;
  registerMgaPayableRoute(routes, options);
  return { calls, registrations };
}

test("admin MGA payable read returns only the explicit projected fields", async () => {
  const fixture = createFixture();
  const response = await invoke(fixture, {
    identity: "admin",
    query: { status: "unpaid" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  const body = response.body as any;
  assert.equal(body.status, "unpaid");
  assert.equal(body.groups[0].items[0].policyId, POLICY_ID);
  assert.equal(body.groups[0].items[0].netDue, "175.00");
  assert.equal(body.summary.outstandingAmount, "175.00");
  for (const excluded of [
    "amountPaid",
    "basePremium",
    "brokerFee",
    "commissionAmount",
    "passwordHash",
    "adminActorUserId",
    "paymentId",
  ]) {
    assert.equal(JSON.stringify(body).includes(`\"${excluded}\"`), false);
  }
  assert.deepEqual(fixture.calls, [
    {
      query: { status: "unpaid" },
      userId: ADMIN_ID,
    },
  ]);
});

test("employee, producer, inactive, and unauthenticated callers receive no payable payload", async () => {
  for (const identity of [
    undefined,
    "employee",
    "producer",
    "inactive",
  ] as const) {
    const fixture = createFixture();
    const response = await invoke(fixture, { identity });
    assert.equal(
      response.status,
      identity === undefined || identity === "inactive" ? 401 : 403,
    );
    assert.deepEqual(fixture.calls, []);
    const serialized = JSON.stringify(response.body);
    assert.equal(serialized.includes(POLICY_ID), false);
    assert.equal(serialized.includes("netDue"), false);
    assert.equal(serialized.includes("Private Insured"), false);
  }
});

test("MGA payable read rejects invalid filters before loading data", async () => {
  const fixture = createFixture();
  const response = await invoke(fixture, {
    identity: "admin",
    query: { status: "settled" },
  });
  assert.equal(response.status, 400);
  assert.deepEqual(fixture.calls, []);
});

test("MGA payable route declares admin authorization and fails closed without guard context", async () => {
  const fixture = createFixture();
  assert.deepEqual(
    fixture.registrations.map(({ access, path }) => ({
      authorized: typeof access.authorization === "function",
      path,
      public: "public" in access,
    })),
    [{ authorized: true, path: MGA_PAYABLES_PATH, public: false }],
  );

  const registration = fixture.registrations[0]!;
  const req = request({}, ADMIN_ID);
  const response = createTestResponse();
  registration.handler(req, response.res, response.next);
  const error = await response.completed;
  assert.notEqual(error, null);
  assert.equal(errorResult(error).status, 500);
  assert.deepEqual(fixture.calls, []);
});

function sourceItem(): MgaPayableSourceItem {
  const policy = {
    ...policyRecord(),
    passwordHash: "must-not-leak",
  } as PolicyRecord;
  return {
    labels: {
      mgaName: "Private MGA",
      policyTypeName: "General Liability",
      producerDisplayName: "Kaylee",
    },
    payment: {
      adminActorUserId: ADMIN_ID,
      paidAt: null,
      paymentId: "must-not-leak",
      policyId: POLICY_ID,
      reference: null,
      status: "unpaid",
    } as MgaPayableSourceItem["payment"],
    policy,
  };
}

function policyRecord(): PolicyRecord {
  const at = new Date("2026-07-11T12:00:00.000Z");
  return {
    accountAssignment: "book",
    amountPaid: "350.00",
    approvedAt: at,
    balanceDueDate: null,
    basePremium: "1000.00",
    brokerFee: "50.00",
    carrierId: "00000000-0000-4000-8000-000000000020",
    collectedToDate: "0.00",
    commissionAmount: "125.00",
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "12.5000",
    companyName: null,
    createdAt: at,
    depositOption: "350.00",
    effectiveDate: "2026-07-01",
    expirationDate: "2027-07-01",
    financeBalance: "0.00",
    financeContact: null,
    financeMeta: null,
    financeReference: null,
    id: POLICY_ID,
    insuredName: "Private Insured",
    invoiceNumber: null,
    ipfsFinanced: null,
    ipfsManual: false,
    ipfsPushed: false,
    ipfsPushedAt: null,
    ipfsReturning: null,
    kayleeSplit: "book",
    mgaFee: "25.00",
    mgaId: MGA_ID,
    mgaPaid: false,
    mgaPaidAt: null,
    producerCommissionReceivedAt: null,
    deletedAt: null,
    deletedByUserId: null,
    deleteReason: null,
    mgaPayReference: null,
    netDue: "175.00",
    netDueTotal: "0.00",
    notes: null,
    officeLocationId: "00000000-0000-4000-8000-000000000021",
    overridden: true,
    payableStatus: "paid",
    paymentMode: "full",
    policyNumber: "GL-100",
    policyTypeId: "00000000-0000-4000-8000-000000000022",
    premiumTotal: "0.00",
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

type Identity = "admin" | "employee" | "producer" | "inactive";

async function invoke(
  fixture: ReturnType<typeof createFixture>,
  options: { identity?: Identity; query?: unknown },
): Promise<TestResult> {
  const registration = fixture.registrations[0];
  assert.ok(registration);
  const userId =
    options.identity === "admin"
      ? ADMIN_ID
      : options.identity === "employee"
        ? EMPLOYEE_ID
        : options.identity === "producer"
          ? PRODUCER_ID
          : options.identity === "inactive"
            ? INACTIVE_ID
            : undefined;
  const req = request(options.query ?? {}, userId);
  const response = createTestResponse();
  const guard = registration.access.authorization;
  assert.ok(guard);
  const guardError = await invokeNextMiddleware(guard, req, response.res);
  if (guardError !== null) {
    return errorResult(guardError);
  }
  registration.handler(req, response.res, response.next);
  const handlerError = await response.completed;
  return handlerError === null ? response.result() : errorResult(handlerError);
}

function request(query: unknown, userId?: string): Request {
  return {
    headers: {},
    method: "GET",
    originalUrl: MGA_PAYABLES_PATH,
    params: {},
    query,
    route: { path: MGA_PAYABLES_PATH },
    session: fakeSession(userId),
  } as unknown as Request;
}

function fakeSession(userId?: string): Request["session"] {
  const session = {
    cookie: {},
    destroy(callback: (error?: unknown) => void) {
      callback();
    },
  } as unknown as Request["session"];
  if (userId !== undefined) {
    session.userId = userId;
    session.sessionVersion = 0;
  }
  return session;
}

interface TestResult {
  body: unknown;
  headers: Record<string, string>;
  status: number;
}

function createTestResponse(): {
  completed: Promise<unknown | null>;
  next: NextFunction;
  res: Response;
  result(): TestResult;
} {
  let status = 200;
  let body: unknown;
  const headers: Record<string, string> = {};
  let resolveCompleted!: (error: unknown | null) => void;
  const completed = new Promise<unknown | null>((resolve) => {
    resolveCompleted = resolve;
  });
  const res = {
    clearCookie() {
      return res;
    },
    locals: {},
    json(value: unknown) {
      body = value;
      resolveCompleted(null);
      return res;
    },
    set(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return res;
    },
    status(value: number) {
      status = value;
      return res;
    },
  } as unknown as Response;
  return {
    completed,
    next(error?: unknown) {
      resolveCompleted(error ?? null);
    },
    res,
    result: () => ({ body, headers, status }),
  };
}

async function invokeNextMiddleware(
  middleware: RequestHandler,
  req: Request,
  res: Response,
): Promise<unknown | null> {
  return new Promise((resolve) => {
    middleware(req, res, (error?: unknown) => resolve(error ?? null));
  });
}

function errorResult(error: unknown): TestResult {
  const response = toErrorResponse(error);
  return {
    body: response.response,
    headers: {},
    status: response.statusCode,
  };
}

function account(id: string, isActive = true): UserAccount {
  const at = new Date("2026-07-11T12:00:00.000Z");
  return {
    createdAt: at,
    email: `${id}@example.test`,
    id,
    isActive,
    sessionVersion: 0,
  };
}

function principal(
  id: string,
  access: Partial<AccessPrincipal> = {},
): AccessPrincipal {
  return {
    capabilities: [],
    staffRole: null,
    userActive: true,
    userId: id,
    ...access,
  };
}
