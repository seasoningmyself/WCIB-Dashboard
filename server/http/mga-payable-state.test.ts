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
import { MgaPayableStateConflictError } from "../policies/mga-payable-state.js";
import { toErrorResponse } from "./errors.js";
import {
  MGA_PAYABLE_STATE_PATH,
  registerMgaPayableStateRoute,
  type RegisterMgaPayableStateRouteOptions,
} from "./mga-payable-state.js";
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
const SHEET_ID = "00000000-0000-4000-8000-000000000012";

const logger: AppLogger = { error() {}, info() {}, warn() {} };

interface Registration {
  access: RouteAccessDeclaration;
  handler: RequestHandler;
  path: string;
}

function createFixture(options: { conflict?: boolean } = {}) {
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
  const calls: Array<{ input: unknown; policyId: string; userId: string }> = [];
  const registrations: Registration[] = [];
  const routeOptions: RegisterMgaPayableStateRouteOptions = {
    authorization,
    async change(context, policyId, input) {
      calls.push({ input, policyId, userId: context.principal.userId });
      if (options.conflict === true) {
        throw new MgaPayableStateConflictError();
      }
      return {
        placement: { associationCount: 1, paySheetIds: [SHEET_ID] },
        source: sourceItem(),
      };
    },
    logger,
  };
  const routes = {
    put(
      path: string,
      access: RouteAccessDeclaration,
      ...handlers: RequestHandler[]
    ) {
      assert.ok(handlers[0]);
      registrations.push({ access, handler: handlers[0], path });
    },
  } as unknown as RouteRegistrar;
  registerMgaPayableStateRoute(routes, routeOptions);
  return { calls, registrations };
}

test("admin MGA payable mutation returns only projected state and placement", async () => {
  const fixture = createFixture();
  const response = await invoke(fixture, {
    body: { reference: "  WIRE-123  ", status: "paid" },
    identity: "admin",
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(fixture.calls, [
    {
      input: { reference: "WIRE-123", status: "paid" },
      policyId: POLICY_ID,
      userId: ADMIN_ID,
    },
  ]);
  const body = response.body as any;
  assert.equal(body.item.policyId, POLICY_ID);
  assert.equal(body.item.status, "paid");
  assert.equal(body.item.netDue, "175.00");
  assert.equal(body.item.amountPaid, "350.00");
  assert.equal(body.item.brokerFee, "50.00");
  assert.equal(body.item.commissionAmount, "125.00");
  assert.equal(body.item.commissionRate, "12.5000");
  assert.deepEqual(body.placement, {
    associationCount: 1,
    paySheetIds: [SHEET_ID],
  });
  for (const excluded of [
    "basePremium",
    "adminActorUserId",
    "paymentId",
    "frozenTotals",
  ]) {
    assert.equal(JSON.stringify(body).includes(`\"${excluded}\"`), false);
  }
});

test("non-admin identities receive no MGA mutation payload and cause no write", async () => {
  for (const identity of [
    undefined,
    "employee",
    "producer",
    "inactive",
  ] as const) {
    const fixture = createFixture();
    const response = await invoke(fixture, {
      body: { status: "unpaid" },
      identity,
    });
    assert.equal(
      response.status,
      identity === undefined || identity === "inactive" ? 401 : 403,
    );
    assert.deepEqual(fixture.calls, []);
    assert.equal(JSON.stringify(response.body).includes(POLICY_ID), false);
  }
});

test("MGA payable mutation rejects unsafe inputs before service access", async () => {
  for (const body of [
    { reference: "not-allowed", status: "unpaid" },
    { actorUserId: ADMIN_ID, status: "paid" },
    { status: "settled" },
  ]) {
    const fixture = createFixture();
    const response = await invoke(fixture, { body, identity: "admin" });
    assert.equal(response.status, 400);
    assert.deepEqual(fixture.calls, []);
  }
});

test("MGA payable mutation maps transaction conflicts to a minimal response", async () => {
  const fixture = createFixture({ conflict: true });
  const response = await invoke(fixture, {
    body: { status: "paid" },
    identity: "admin",
  });
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    error: {
      code: "bad_request",
      message: "MGA payable state cannot be changed",
    },
  });
  assert.equal(JSON.stringify(response.body).includes("pay_sheet"), false);
});

test("MGA payable mutation is explicitly admin-guarded and its handler fails closed alone", async () => {
  const fixture = createFixture();
  const registration = fixture.registrations[0];
  assert.ok(registration);
  assert.deepEqual(
    {
      authorized: typeof registration.access.authorization === "function",
      path: registration.path,
      public: "public" in registration.access,
    },
    { authorized: true, path: MGA_PAYABLE_STATE_PATH, public: false },
  );

  const req = request({ status: "paid" }, ADMIN_ID);
  const response = createTestResponse();
  registration.handler(req, response.res, response.next);
  const error = await response.completed;
  assert.notEqual(error, null);
  assert.equal(errorResult(error).status, 500);
  assert.deepEqual(fixture.calls, []);
});

function sourceItem(): MgaPayableSourceItem {
  const at = new Date("2026-07-11T12:00:00.000Z");
  return {
    labels: {
      mgaName: "Private MGA",
      policyTypeName: "General Liability",
      producerDisplayName: "Kaylee",
    },
    payment: {
      paidAt: at,
      policyId: POLICY_ID,
      reference: "WIRE-123",
      status: "paid",
    },
    policy: {
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
      mgaPaid: true,
      mgaPaidAt: at,
    producerCommissionReceivedAt: null,
    deletedAt: null,
    deletedByUserId: null,
    deleteReason: null,
      mgaPayReference: "WIRE-123",
      netDue: "175.00",
      netDueTotal: "0.00",
      notes: null,
      officeLocationId: "00000000-0000-4000-8000-000000000021",
      overridden: false,
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
    } satisfies PolicyRecord,
  };
}

type Identity = "admin" | "employee" | "producer" | "inactive";

async function invoke(
  fixture: ReturnType<typeof createFixture>,
  options: { body: unknown; identity?: Identity },
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
  const req = request(options.body, userId);
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

function request(body: unknown, userId?: string): Request {
  return {
    body,
    headers: {},
    method: "PUT",
    originalUrl: MGA_PAYABLE_STATE_PATH,
    params: { policyId: POLICY_ID },
    query: {},
    route: { path: MGA_PAYABLE_STATE_PATH },
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
