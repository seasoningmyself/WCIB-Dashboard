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
  MGA_PAYABLE_GROUP_STATE_PATH,
  registerMgaPayableGroupStateRoute,
  type RegisterMgaPayableGroupStateRouteOptions,
} from "./mga-payable-group-state.js";
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

test("admin group mutation returns only projected policy and placement fields", async () => {
  const fixture = createFixture();
  const response = await invoke(fixture, {
    body: { status: "paid" },
    identity: "admin",
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(fixture.calls, [
    { input: { status: "paid" }, mgaId: MGA_ID, userId: ADMIN_ID },
  ]);
  const body = response.body as any;
  assert.equal(body.changedCount, 1);
  assert.equal(body.status, "paid");
  assert.equal(body.results[0].item.policyId, POLICY_ID);
  assert.equal(body.results[0].item.amountPaid, "350.00");
  assert.deepEqual(body.results[0].placement, {
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

test("non-admin identities receive no group payload and cause no mutation", async () => {
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

test("group mutation rejects undeclared inputs and is explicitly admin guarded", async () => {
  for (const body of [
    { reference: "shared-ref", status: "paid" },
    { actorUserId: ADMIN_ID, status: "paid" },
    { status: "settled" },
  ]) {
    const fixture = createFixture();
    const response = await invoke(fixture, { body, identity: "admin" });
    assert.equal(response.status, 400);
    assert.deepEqual(fixture.calls, []);
  }

  const fixture = createFixture();
  const registration = fixture.registrations[0];
  assert.ok(registration);
  assert.deepEqual(
    {
      authorized: typeof registration.access.authorization === "function",
      path: registration.path,
      public: "public" in registration.access,
    },
    { authorized: true, path: MGA_PAYABLE_GROUP_STATE_PATH, public: false },
  );
  const response = createTestResponse();
  registration.handler(
    request({ status: "paid" }, ADMIN_ID),
    response.res,
    response.next,
  );
  assert.equal(errorResult(await response.completed).status, 500);
  assert.deepEqual(fixture.calls, []);
});

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
    [INACTIVE_ID, principal(INACTIVE_ID, { staffRole: "employee", userActive: false })],
  ]);
  const authorization = createAuthorizationGuards({
    async findUser(userId) { return users.get(userId) ?? null; },
    async loadPrincipal(userId) { return principals.get(userId) ?? null; },
    logger,
  });
  const calls: Array<{ input: unknown; mgaId: string; userId: string }> = [];
  const registrations: Registration[] = [];
  const options: RegisterMgaPayableGroupStateRouteOptions = {
    authorization,
    async change(context, mgaId, input) {
      calls.push({ input, mgaId, userId: context.principal.userId });
      return {
        results: [{
          placement: { associationCount: 1, paySheetIds: [SHEET_ID] },
          source: sourceItem(),
        }],
        status: "paid",
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
  registerMgaPayableGroupStateRoute(routes, options);
  return { calls, registrations };
}

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
      reference: null,
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
      deletedAt: null,
      deletedByUserId: null,
      deleteReason: null,
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
      mgaPayReference: null,
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
    } satisfies PolicyRecord,
  };
}

type Identity = "admin" | "employee" | "producer" | "inactive";

async function invoke(
  fixture: ReturnType<typeof createFixture>,
  options: { body: unknown; identity?: Identity },
): Promise<TestResult> {
  const registration = fixture.registrations[0]!;
  const userId = options.identity === "admin"
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
  const guardError = await invokeMiddleware(guard, req, response.res);
  if (guardError !== null) return errorResult(guardError);
  registration.handler(req, response.res, response.next);
  const handlerError = await response.completed;
  return handlerError === null ? response.result() : errorResult(handlerError);
}

function request(body: unknown, userId?: string): Request {
  const session = {
    cookie: {},
    destroy(callback: (error?: unknown) => void) { callback(); },
  } as unknown as Request["session"];
  if (userId !== undefined) {
    session.userId = userId;
    session.sessionVersion = 0;
  }
  return {
    body,
    headers: {},
    method: "PUT",
    originalUrl: MGA_PAYABLE_GROUP_STATE_PATH,
    params: { mgaId: MGA_ID },
    query: {},
    route: { path: MGA_PAYABLE_GROUP_STATE_PATH },
    session,
  } as unknown as Request;
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
  let complete!: (error: unknown | null) => void;
  const completed = new Promise<unknown | null>((resolve) => { complete = resolve; });
  const res = {
    clearCookie() { return res; },
    locals: {},
    json(value: unknown) { body = value; complete(null); return res; },
    set(name: string, value: string) { headers[name.toLowerCase()] = value; return res; },
    status(value: number) { status = value; return res; },
  } as unknown as Response;
  return {
    completed,
    next(error?: unknown) { complete(error ?? null); },
    res,
    result() { return { body, headers, status }; },
  };
}

async function invokeMiddleware(
  handler: RequestHandler,
  req: Request,
  res: Response,
): Promise<unknown | null> {
  return new Promise((resolve) => {
    handler(req, res, (error?: unknown) => resolve(error ?? null));
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
  return {
    createdAt: new Date("2026-07-11T12:00:00.000Z"),
    displayName: id,
    email: `${id}@example.test`,
    id,
    isActive,
    passwordChangeRequiredAt: null,
    sessionVersion: 0,
  };
}

function principal(
  userId: string,
  overrides: Partial<AccessPrincipal> = {},
): AccessPrincipal {
  return {
    capabilities: [],
    staffRole: null,
    userActive: true,
    userId,
    ...overrides,
  };
}
