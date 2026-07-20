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
import type { AppLogger } from "../logging/logger.js";
import type { PaySheetSource } from "../pay-sheets/read.js";
import { toErrorResponse } from "./errors.js";
import {
  PAY_SHEET_DETAIL_PATH,
  PAY_SHEETS_PATH,
  registerPaySheetReadRoutes,
  type RegisterPaySheetReadRoutesOptions,
} from "./pay-sheets.js";
import type {
  RouteAccessDeclaration,
  RouteRegistrar,
} from "./routes.js";

const ADMIN_ID = uuid(1);
const PRODUCER_ID = uuid(2);
const EMPLOYEE_ID = uuid(3);
const INACTIVE_ID = uuid(4);
const PAY_SHEET_ID = uuid(10);
const POLICY_ID = uuid(11);

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
  const calls: Array<{ kind: "get" | "list"; value: unknown }> = [];
  const registrations: Registration[] = [];
  const options: RegisterPaySheetReadRoutesOptions = {
    authorization,
    async get(context, paySheetId) {
      calls.push({
        kind: "get",
        value: { paySheetId, userId: context.principal.userId },
      });
      return source();
    },
    async list(context, query) {
      calls.push({
        kind: "list",
        value: { query, userId: context.principal.userId },
      });
      return { items: [source()], query: query as never };
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
  registerPaySheetReadRoutes(routes, options);
  return { calls, registrations };
}

test("admin pay-sheet list and detail return only explicit projected contracts", async () => {
  const fixture = createFixture();
  const list = await invoke(fixture, PAY_SHEETS_PATH, {
    identity: "admin",
    query: { ownerType: "sophia", status: "closed" },
  });
  assert.equal(list.status, 200);
  assert.equal(list.headers["cache-control"], "no-store");
  const listBody = list.body as any;
  assert.equal(listBody.items[0].id, PAY_SHEET_ID);
  assert.equal(listBody.items[0].totals.sophiaAgencyGross, "250.00");
  assert.equal(listBody.items[0].totals.sophiaTakeHome, "212.50");
  assert.notEqual(
    listBody.items[0].totals.sophiaAgencyGross,
    listBody.items[0].totals.sophiaTakeHome,
  );

  const detail = await invoke(fixture, PAY_SHEET_DETAIL_PATH, {
    identity: "admin",
    params: { paySheetId: PAY_SHEET_ID },
  });
  assert.equal(detail.status, 200);
  assert.equal(detail.headers["cache-control"], "no-store");
  const detailBody = detail.body as any;
  assert.equal(detailBody.sheet.policies[0].policyId, POLICY_ID);
  assert.equal(detailBody.sheet.policies[0].source, "frozen");

  const serialized = JSON.stringify({ detail: detail.body, list: list.body });
  for (const excluded of [
    "ownerEmail",
    "frozenTotals",
    "frozenPolicySnapshot",
    "frozenRateSnapshot",
    "passwordHash",
  ]) {
    assert.equal(serialized.includes(`\"${excluded}\"`), false);
  }
  assert.deepEqual(fixture.calls, [
    {
      kind: "list",
      value: {
        query: {
          ownerType: "sophia",
          ownerUserId: null,
          periodMonth: null,
          periodYear: null,
          status: "closed",
        },
        userId: ADMIN_ID,
      },
    },
    {
      kind: "get",
      value: { paySheetId: PAY_SHEET_ID, userId: ADMIN_ID },
    },
  ]);
});

test("employee, producer, inactive, and anonymous callers receive no pay-sheet payload", async () => {
  for (const identity of [
    undefined,
    "employee",
    "producer",
    "inactive",
  ] as const) {
    for (const path of [PAY_SHEETS_PATH, PAY_SHEET_DETAIL_PATH]) {
      const fixture = createFixture();
      const result = await invoke(fixture, path, {
        identity,
        params: path === PAY_SHEET_DETAIL_PATH ? { paySheetId: PAY_SHEET_ID } : {},
      });
      assert.equal(
        result.status,
        identity === undefined || identity === "inactive" ? 401 : 403,
      );
      assert.deepEqual(fixture.calls, []);
      const serialized = JSON.stringify(result.body);
      assert.equal(serialized.includes(PAY_SHEET_ID), false);
      assert.equal(serialized.includes(POLICY_ID), false);
      assert.equal(serialized.includes("sophiaAgencyGross"), false);
    }
  }
});

test("pay-sheet reads reject invalid filters and identifiers before data access", async () => {
  const fixture = createFixture();
  const badFilter = await invoke(fixture, PAY_SHEETS_PATH, {
    identity: "admin",
    query: { status: "reopened" },
  });
  assert.equal(badFilter.status, 400);
  const badId = await invoke(fixture, PAY_SHEET_DETAIL_PATH, {
    identity: "admin",
    params: { paySheetId: "not-a-uuid" },
  });
  assert.equal(badId.status, 400);
  assert.deepEqual(fixture.calls, []);
});

test("pay-sheet routes declare admin authorization and fail closed without guard context", async () => {
  const fixture = createFixture();
  assert.deepEqual(
    fixture.registrations.map(({ access, path }) => ({
      authorized: typeof access.authorization === "function",
      path,
      public: "public" in access,
    })),
    [
      { authorized: true, path: PAY_SHEETS_PATH, public: false },
      { authorized: true, path: PAY_SHEET_DETAIL_PATH, public: false },
    ],
  );

  for (const registration of fixture.registrations) {
    const req = request(
      registration.path,
      {},
      registration.path === PAY_SHEET_DETAIL_PATH
        ? { paySheetId: PAY_SHEET_ID }
        : {},
      ADMIN_ID,
    );
    const response = createTestResponse();
    registration.handler(req, response.res, response.next);
    const error = await response.completed;
    assert.notEqual(error, null);
    assert.equal(errorResult(error).status, 500);
  }
  assert.deepEqual(fixture.calls, []);
});

function source(): PaySheetSource {
  const closedAt = new Date("2026-07-31T12:00:00.000Z");
  return {
    adjustments: [],
    header: {
      ownerDisplayName: "Sophia",
      ownerEmail: "sophia-private@example.test",
      sheet: {
        closedAt,
        closedByUserId: ADMIN_ID,
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        frozenTotals: {
          brokerFees: "50.00",
          commissions: "100.00",
          directCheckAchIncome: "100.00",
          grandTotalIncome: "250.00",
          sophiaAgencyGross: "250.00",
          sophiaShare: "112.50",
          sophiaTakeHome: "212.50",
          trustPull: "150.00",
        },
        id: PAY_SHEET_ID,
        openedAt: new Date("2026-07-01T00:00:00.000Z"),
        ownerType: "sophia",
        ownerUserId: ADMIN_ID,
        periodMonth: 7,
        periodYear: 2026,
        status: "closed",
        updatedAt: closedAt,
      },
    },
    policies: [
      {
        kind: "frozen",
        value: {
          addedAt: new Date("2026-07-02T00:00:00.000Z"),
          associationId: uuid(12),
          producerDisplayName: "Kaylee",
          frozenPolicySnapshot: {
            agencyRevenue: "150.00",
            approvedAt: "2026-06-30T12:00:00.000Z",
            brokerFee: "50.00",
            commissionAmount: "100.00",
            effectiveDate: "2026-07-01",
            insuredName: "Frozen Insured",
            kayleeSplit: "book",
            officeLocationId: uuid(13),
            policyId: POLICY_ID,
            policyNumber: "POL-FROZEN",
            policyTypeClass: "Commercial",
            policyTypeName: "General Liability",
            producerPayout: "0.00",
            producerUserId: PRODUCER_ID,
            sophiaShare: "112.50",
            transactionType: "New",
          },
          frozenRateSnapshot: null,
        },
      },
    ],
    rate: null,
  };
}

type Identity = "admin" | "employee" | "producer" | "inactive";

async function invoke(
  fixture: ReturnType<typeof createFixture>,
  path: string,
  options: {
    identity?: Identity;
    params?: Record<string, string>;
    query?: unknown;
  },
): Promise<TestResult> {
  const registration = fixture.registrations.find(
    (candidate) => candidate.path === path,
  );
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
  const req = request(path, options.query ?? {}, options.params ?? {}, userId);
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

function request(
  path: string,
  query: unknown,
  params: Record<string, string>,
  userId?: string,
): Request {
  return {
    headers: {},
    method: "GET",
    originalUrl: path,
    params,
    query,
    route: { path },
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

function account(userId: string, isActive = true): UserAccount {
  return {
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    displayName: userId,
    email: `${userId}@example.test`,
    id: userId,
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

function uuid(suffix: number): string {
  return `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}
