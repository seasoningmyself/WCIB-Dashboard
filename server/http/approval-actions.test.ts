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
import { ApprovalItemStateError } from "../approval-queue/approve.js";
import { toErrorResponse } from "./errors.js";
import {
  APPROVE_SUBMISSION_PATH,
  OPEN_FIX_HELP_PATH,
  PUSH_THROUGH_HELP_PATH,
  registerApprovalActionRoutes,
  type RegisterApprovalActionRoutesOptions,
} from "./approval-actions.js";
import type {
  RouteAccessDeclaration,
  RouteRegistrar,
} from "./routes.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000002";
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000003";
const QUEUE_ID = "00000000-0000-4000-8000-000000000010";
const DRAFT_ID = "00000000-0000-4000-8000-000000000011";
const POLICY_ID = "00000000-0000-4000-8000-000000000012";

const logger: AppLogger = { error() {}, info() {}, warn() {} };

interface Registration {
  access: RouteAccessDeclaration;
  handler: RequestHandler;
  path: string;
}

function createFixture(options: { fail?: boolean } = {}) {
  const users = new Map<string, UserAccount>([
    [ADMIN_ID, account(ADMIN_ID)],
    [PRODUCER_ID, account(PRODUCER_ID)],
    [EMPLOYEE_ID, account(EMPLOYEE_ID)],
  ]);
  const principals = new Map<string, AccessPrincipal>([
    [ADMIN_ID, principal(ADMIN_ID, { capabilities: ["admin"] })],
    [PRODUCER_ID, principal(PRODUCER_ID, { staffRole: "producer" })],
    [EMPLOYEE_ID, principal(EMPLOYEE_ID, { staffRole: "employee" })],
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
  const calls: Array<{ body?: unknown; id: string; kind: string }> = [];
  const registrations: Registration[] = [];
  const optionsForRoute: RegisterApprovalActionRoutesOptions = {
    async approve(_context, queueEntryId) {
      calls.push({ id: queueEntryId, kind: "approve" });
      if (options.fail === true) throw new ApprovalItemStateError();
      return policy();
    },
    async approveFixedHelp(_context, draftId, body) {
      calls.push({ body, id: draftId, kind: "fix" });
      return policy();
    },
    authorization,
    logger,
    async pushThroughHelp(_context, draftId) {
      calls.push({ id: draftId, kind: "push" });
      return policy();
    },
  };
  const routes = {
    post(
      path: string,
      access: RouteAccessDeclaration,
      ...handlers: RequestHandler[]
    ) {
      assert.ok(handlers[0]);
      registrations.push({ access, handler: handlers[0], path });
    },
  } as unknown as RouteRegistrar;
  registerApprovalActionRoutes(routes, optionsForRoute);
  return { calls, registrations };
}

test("admin approval accepts identity only and returns the admin policy projection", async () => {
  const fixture = createFixture();
  const response = await invoke(
    fixture,
    APPROVE_SUBMISSION_PATH,
    { queueEntryId: QUEUE_ID },
    {},
    "admin",
  );
  assert.equal(response.status, 201);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal((response.body as any).policy.id, POLICY_ID);
  assert.equal("passwordHash" in (response.body as any).policy, false);
  assert.deepEqual(fixture.calls, [{ id: QUEUE_ID, kind: "approve" }]);

  const forged = createFixture();
  const rejected = await invoke(
    forged,
    APPROVE_SUBMISSION_PATH,
    { queueEntryId: QUEUE_ID },
    { basePremium: "0.00", submittedByUserId: ADMIN_ID },
    "admin",
  );
  assert.equal(rejected.status, 400);
  assert.deepEqual(forged.calls, []);
});

test("flagged push-through and open-fix are distinct allowlisted admin actions", async () => {
  const fixture = createFixture();
  const pushed = await invoke(
    fixture,
    PUSH_THROUGH_HELP_PATH,
    { draftId: DRAFT_ID },
    {},
    "admin",
  );
  assert.equal(pushed.status, 201);
  const fixed = await invoke(
    fixture,
    OPEN_FIX_HELP_PATH,
    { draftId: DRAFT_ID },
    { insuredName: "Corrected Insured" },
    "admin",
  );
  assert.equal(fixed.status, 201);
  assert.deepEqual(fixture.calls, [
    { id: DRAFT_ID, kind: "push" },
    {
      body: { insuredName: "Corrected Insured" },
      id: DRAFT_ID,
      kind: "fix",
    },
  ]);

  const rejected = createFixture();
  const unsafe = await invoke(
    rejected,
    OPEN_FIX_HELP_PATH,
    { draftId: DRAFT_ID },
    { ownerUserId: ADMIN_ID },
    "admin",
  );
  assert.equal(unsafe.status, 400);
  assert.deepEqual(rejected.calls, []);
});

test("employee and producer are denied on every approval action before service access", async () => {
  for (const identity of [undefined, "employee", "producer"] as const) {
    for (const [path, params, body] of [
      [APPROVE_SUBMISSION_PATH, { queueEntryId: QUEUE_ID }, {}],
      [PUSH_THROUGH_HELP_PATH, { draftId: DRAFT_ID }, {}],
      [OPEN_FIX_HELP_PATH, { draftId: DRAFT_ID }, { insuredName: "No" }],
    ] as const) {
      const fixture = createFixture();
      const response = await invoke(fixture, path, params, body, identity);
      assert.equal(response.status, identity === undefined ? 401 : 403);
      assert.deepEqual(fixture.calls, []);
      assert.equal(JSON.stringify(response.body).includes("basePremium"), false);
    }
  }
});

test("stale approval conflicts are safe and every action route is guarded", async () => {
  const failed = createFixture({ fail: true });
  const response = await invoke(
    failed,
    APPROVE_SUBMISSION_PATH,
    { queueEntryId: QUEUE_ID },
    {},
    "admin",
  );
  assert.equal(response.status, 409);
  for (const registration of failed.registrations) {
    assert.equal(typeof registration.access.authorization, "function");
    assert.equal("public" in registration.access, false);
  }
});

function policy(): PolicyRecord & Record<string, unknown> {
  const timestamp = new Date("2026-07-11T12:00:00.000Z");
  return {
    accountAssignment: "book",
    amountPaid: "250.00",
    approvedAt: timestamp,
    balanceDueDate: null,
    basePremium: "1000.00",
    brokerFee: "20.00",
    carrierId: "00000000-0000-4000-8000-000000000021",
    collectedToDate: "0.00",
    commissionAmount: "125.00",
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "12.5000",
    companyName: null,
    createdAt: timestamp,
    depositOption: "250.00",
    effectiveDate: "2026-07-11",
    expirationDate: "2027-07-11",
    financeBalance: "780.00",
    financeContact: null,
    financeMeta: null,
    financeReference: null,
    id: POLICY_ID,
    insuredName: "Approved Insured",
    invoiceNumber: null,
    ipfsFinanced: "no",
    ipfsManual: false,
    ipfsPushed: false,
    ipfsPushedAt: null,
    ipfsReturning: null,
    kayleeSplit: "book",
    mgaFee: "10.00",
    mgaId: "00000000-0000-4000-8000-000000000022",
    mgaPaid: false,
    mgaPaidAt: null,
    mgaPayReference: null,
    netDue: "895.00",
    netDueTotal: "0.00",
    notes: null,
    officeLocationId: "00000000-0000-4000-8000-000000000023",
    overridden: false,
    passwordHash: "must-not-leak",
    payableStatus: "paid",
    paymentMode: "deposit",
    policyNumber: "APPROVED-1",
    policyTypeId: "00000000-0000-4000-8000-000000000024",
    premiumTotal: "0.00",
    producerUserId: "00000000-0000-4000-8000-000000000025",
    proposalTotal: "1030.00",
    receivableStatus: "paid",
    remittedToMga: "0.00",
    sourceDraftId: DRAFT_ID,
    submittedAt: timestamp,
    submittedByUserId: EMPLOYEE_ID,
    taxes: "0.00",
    transactionNotes: null,
    transactionType: "New",
    updatedAt: timestamp,
  };
}

function account(id: string): UserAccount {
  return {
    createdAt: new Date("2026-07-11T12:00:00.000Z"),
    email: `${id}@example.test`,
    id,
    isActive: true,
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

async function invoke(
  fixture: ReturnType<typeof createFixture>,
  path: string,
  params: Record<string, string>,
  body: unknown,
  identity?: "admin" | "employee" | "producer",
): Promise<TestResult> {
  const registration = fixture.registrations.find((item) => item.path === path);
  assert.ok(registration);
  const userId =
    identity === "admin"
      ? ADMIN_ID
      : identity === "employee"
        ? EMPLOYEE_ID
        : identity === "producer"
          ? PRODUCER_ID
          : undefined;
  const req = {
    body,
    headers: {},
    method: "POST",
    originalUrl: path,
    params,
    route: { path },
    session: fakeSession(userId),
  } as unknown as Request;
  const response = createTestResponse();
  const guard = registration.access.authorization;
  assert.ok(guard);
  const guardError = await invokeNextMiddleware(guard, req, response.res);
  if (guardError !== null) return errorResult(guardError);
  registration.handler(req, response.res, response.next);
  const handlerError = await response.completed;
  return handlerError === null ? response.result() : errorResult(handlerError);
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
  let body: unknown = null;
  let status = 200;
  const headers: Record<string, string> = {};
  let complete: (error: unknown | null) => void = () => undefined;
  const completed = new Promise<unknown | null>((resolve) => {
    complete = resolve;
  });
  const res = {
    clearCookie() {
      return res;
    },
    json(value: unknown) {
      body = value;
      complete(null);
      return res;
    },
    locals: {},
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
      complete(error ?? null);
    },
    res,
    result: () => ({ body, headers, status }),
  };
}

async function invokeNextMiddleware(
  handler: RequestHandler,
  req: Request,
  res: Response,
): Promise<unknown | null> {
  return new Promise((resolve) => {
    handler(req, res, (error?: unknown) => resolve(error ?? null));
  });
}

function errorResult(error: unknown): TestResult {
  const result = toErrorResponse(error);
  return { body: result.response, headers: {}, status: result.statusCode };
}
