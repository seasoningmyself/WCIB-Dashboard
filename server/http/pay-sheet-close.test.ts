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
  PAY_SHEET_CLOSE_PATH,
  registerPaySheetCloseRoute,
  type RegisterPaySheetCloseRouteOptions,
} from "./pay-sheet-close.js";
import type {
  RouteAccessDeclaration,
  RouteRegistrar,
} from "./routes.js";

const ADMIN_ID = uuid(1);
const PRODUCER_ID = uuid(2);
const EMPLOYEE_ID = uuid(3);
const INACTIVE_ID = uuid(4);
const CLOSED_SHEET_ID = uuid(10);
const NEXT_SHEET_ID = uuid(11);
const POLICY_ID = uuid(12);
const CASCADED_SHEET_ID = uuid(20);
const CASCADED_NEXT_SHEET_ID = uuid(21);
const logger: AppLogger = { error() {}, info() {}, warn() {} };

interface Registration {
  access: RouteAccessDeclaration;
  handler: RequestHandler;
  path: string;
}

function createFixture(overrides: {
  cascaded?: boolean;
  closeError?: unknown;
  closed?: boolean;
} = {}) {
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
  const calls: Array<{ kind: "close" | "get"; value: unknown }> = [];
  const registrations: Registration[] = [];
  const options: RegisterPaySheetCloseRouteOptions = {
    authorization,
    async close(context, paySheetId, cascadeProducerSheets) {
      calls.push({
        kind: "close",
        value: {
          cascadeProducerSheets,
          paySheetId,
          userId: context.principal.userId,
        },
      });
      if (overrides.closeError !== undefined) throw overrides.closeError;
      return {
        cascaded: overrides.cascaded
          ? [
              {
                close: {
                  closed: true,
                  nextSheetId: CASCADED_NEXT_SHEET_ID,
                  ownerType: "producer",
                  periodMonth: 7,
                  periodYear: 2026,
                  policyCount: 1,
                },
                paySheetId: CASCADED_SHEET_ID,
              },
            ]
          : [],
        primary: {
          closed: overrides.closed ?? true,
          nextSheetId: NEXT_SHEET_ID,
          ownerType: "sophia",
          periodMonth: 7,
          periodYear: 2026,
          policyCount: 1,
        },
      };
    },
    async get(context, paySheetId) {
      calls.push({
        kind: "get",
        value: { paySheetId, userId: context.principal.userId },
      });
      if (paySheetId === NEXT_SHEET_ID) return nextSource();
      if (paySheetId === CASCADED_SHEET_ID) return producerClosedSource();
      if (paySheetId === CASCADED_NEXT_SHEET_ID) return producerNextSource();
      return closedSource();
    },
    logger,
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
  registerPaySheetCloseRoute(routes, options);
  return { calls, registrations };
}

test("admin close supplies only trusted context and returns projected history", async () => {
  const fixture = createFixture();
  const result = await invoke(fixture, { identity: "admin" });
  assert.equal(result.status, 200);
  assert.equal(result.headers["cache-control"], "no-store");
  const body = result.body as any;
  assert.equal(body.close.closed, true);
  assert.equal(body.closedSheet.id, CLOSED_SHEET_ID);
  assert.equal(body.nextSheet.id, NEXT_SHEET_ID);
  assert.deepEqual(body.cascaded, []);
  assert.equal(body.closedSheet.totals.sophiaAgencyGross, "250.00");
  assert.equal(body.closedSheet.totals.sophiaTakeHome, "212.50");
  assert.notEqual(
    body.closedSheet.totals.sophiaAgencyGross,
    body.closedSheet.totals.sophiaTakeHome,
  );
  assert.deepEqual(fixture.calls, [
    {
      kind: "close",
      value: {
        cascadeProducerSheets: true,
        paySheetId: CLOSED_SHEET_ID,
        userId: ADMIN_ID,
      },
    },
    {
      kind: "get",
      value: { paySheetId: CLOSED_SHEET_ID, userId: ADMIN_ID },
    },
    {
      kind: "get",
      value: { paySheetId: NEXT_SHEET_ID, userId: ADMIN_ID },
    },
  ]);
  const serialized = JSON.stringify(body);
  for (const excluded of [
    "ownerEmail",
    "frozenTotals",
    "frozenPolicySnapshot",
    "frozenRateSnapshot",
  ]) {
    assert.equal(serialized.includes(`\"${excluded}\"`), false);
  }
});

test("every cascaded sheet is projected before returning", async () => {
  const fixture = createFixture({ cascaded: true });
  const result = await invoke(fixture, { identity: "admin" });
  assert.equal(result.status, 200);
  const body = result.body as any;
  assert.equal(body.cascaded.length, 1);
  assert.equal(body.cascaded[0].closedSheet.id, CASCADED_SHEET_ID);
  assert.equal(body.cascaded[0].closedSheet.ownerType, "producer");
  assert.equal(body.cascaded[0].closedSheet.totals.producerPayout, "37.50");
  assert.equal(body.cascaded[0].nextSheet.id, CASCADED_NEXT_SHEET_ID);
  assert.deepEqual(
    fixture.calls
      .filter(({ kind }) => kind === "get")
      .map(({ value }) => (value as { paySheetId: string }).paySheetId)
      .sort(),
    [
      CASCADED_NEXT_SHEET_ID,
      CASCADED_SHEET_ID,
      CLOSED_SHEET_ID,
      NEXT_SHEET_ID,
    ].sort(),
  );
  const serialized = JSON.stringify(body.cascaded[0]);
  for (const excluded of [
    "ownerEmail",
    "frozenTotals",
    "frozenPolicySnapshot",
    "frozenRateSnapshot",
  ]) {
    assert.equal(serialized.includes(`\"${excluded}\"`), false);
  }
});

test("idempotent close responses retain the established next period", async () => {
  const fixture = createFixture({ closed: false });
  const result = await invoke(fixture, { identity: "admin" });
  assert.equal(result.status, 200);
  assert.equal((result.body as any).close.closed, false);
  assert.equal((result.body as any).close.nextSheetId, NEXT_SHEET_ID);
});

test("close rejects client-authored state before any financial mutation", async () => {
  for (const body of [
    {},
    { actorUserId: ADMIN_ID, cascadeProducerSheets: true },
    {
      cascadeProducerSheets: true,
      frozenTotals: { sophiaTakeHome: "999999.00" },
    },
    { cascadeProducerSheets: true, nextSheetId: uuid(99) },
  ]) {
    const fixture = createFixture();
    const result = await invoke(fixture, { body, identity: "admin" });
    assert.equal(result.status, 400);
    assert.deepEqual(fixture.calls, []);
  }
});

test("employee, producer, inactive, and anonymous close calls cause no write", async () => {
  for (const identity of [
    undefined,
    "employee",
    "producer",
    "inactive",
  ] as const) {
    const fixture = createFixture();
    const result = await invoke(fixture, { identity });
    assert.equal(
      result.status,
      identity === undefined || identity === "inactive" ? 401 : 403,
    );
    assert.deepEqual(fixture.calls, []);
    assert.equal(JSON.stringify(result.body).includes(POLICY_ID), false);
  }
});

test("known close constraints are safe conflicts and no reopen route exists", async () => {
  for (const code of ["23505", "23514", "40001", "55000", "P0002"]) {
    const fixture = createFixture({
      closeError: Object.assign(new Error("private database detail"), { code }),
    });
    const result = await invoke(fixture, { identity: "admin" });
    assert.equal(result.status, 409);
    assert.deepEqual(result.body, {
      error: {
        code: "bad_request",
        message: "Pay sheet cannot be closed",
      },
    });
    assert.equal(JSON.stringify(result.body).includes("database"), false);
    assert.equal(fixture.calls.filter((call) => call.kind === "get").length, 0);
  }

  const fixture = createFixture();
  assert.deepEqual(
    fixture.registrations.map(({ access, path }) => ({
      authorized: typeof access.authorization === "function",
      path,
      public: "public" in access,
    })),
    [{ authorized: true, path: PAY_SHEET_CLOSE_PATH, public: false }],
  );
  assert.equal(
    fixture.registrations.some(({ path }) => /reopen/i.test(path)),
    false,
  );
});

test("close handler fails closed when invoked without authorization context", async () => {
  const fixture = createFixture();
  const registration = fixture.registrations[0];
  assert.ok(registration);
  const response = createTestResponse();
  registration.handler(
    request({ cascadeProducerSheets: true }, ADMIN_ID),
    response.res,
    response.next,
  );
  const error = await response.completed;
  assert.notEqual(error, null);
  assert.equal(errorResult(error).status, 500);
  assert.deepEqual(fixture.calls, []);
});

function closedSource(): PaySheetSource {
  const closedAt = new Date("2026-07-31T12:00:00.000Z");
  return {
    adjustments: [],
    header: {
      ownerDisplayName: "Sophia",
      ownerEmail: "private-sophia@example.test",
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
        id: CLOSED_SHEET_ID,
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
          associationId: uuid(13),
          producerDisplayName: "Kaylee",
          frozenPolicySnapshot: {
            agencyRevenue: "150.00",
            approvedAt: "2026-07-01T12:00:00.000Z",
            brokerFee: "50.00",
            commissionAmount: "100.00",
            effectiveDate: "2026-07-01",
            insuredName: "Frozen Insured",
            kayleeSplit: "book",
            officeLocationId: uuid(14),
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

function nextSource(): PaySheetSource {
  const openedAt = new Date("2026-07-31T12:00:00.000Z");
  return {
    adjustments: [],
    header: {
      ownerDisplayName: "Sophia",
      ownerEmail: "private-sophia@example.test",
      sheet: {
        closedAt: null,
        closedByUserId: null,
        createdAt: openedAt,
        frozenTotals: null,
        id: NEXT_SHEET_ID,
        openedAt,
        ownerType: "sophia",
        ownerUserId: ADMIN_ID,
        periodMonth: 8,
        periodYear: 2026,
        status: "open",
        updatedAt: openedAt,
      },
    },
    policies: [],
    rate: null,
  };
}

function producerClosedSource(): PaySheetSource {
  const source = closedSource();
  const policy = source.policies[0];
  assert.ok(policy?.kind === "frozen");
  return {
    adjustments: [],
    header: {
      ownerDisplayName: "Kaylee",
      ownerEmail: "private-producer@example.test",
      sheet: {
        ...source.header.sheet,
        frozenTotals: {
          brokerFees: "50.00",
          commissions: "100.00",
          directCheckAchIncome: "0.00",
          grandTotalIncome: "150.00",
          producerPayout: "37.50",
          trustPull: "150.00",
        },
        id: CASCADED_SHEET_ID,
        ownerType: "producer",
        ownerUserId: PRODUCER_ID,
      },
    },
    policies: [
      {
        kind: "frozen",
        value: {
          ...policy.value,
          frozenPolicySnapshot: {
            ...(policy.value.frozenPolicySnapshot as Record<string, unknown>),
            producerPayout: "37.50",
          },
          frozenRateSnapshot: {
            effectiveDate: "2026-01-01",
            newBrokerRate: "25.00",
            newCommissionRate: "25.00",
            renewalBrokerRate: "25.00",
            renewalCommissionRate: "25.00",
          },
        },
      },
    ],
    rate: null,
  };
}

function producerNextSource(): PaySheetSource {
  const source = nextSource();
  return {
    ...source,
    header: {
      ownerDisplayName: "Kaylee",
      ownerEmail: "private-producer@example.test",
      sheet: {
        ...source.header.sheet,
        id: CASCADED_NEXT_SHEET_ID,
        ownerType: "producer",
        ownerUserId: PRODUCER_ID,
      },
    },
  };
}

type Identity = "admin" | "employee" | "producer" | "inactive";

async function invoke(
  fixture: ReturnType<typeof createFixture>,
  options: { body?: unknown; identity?: Identity },
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
  const req = request(
    options.body ?? { cascadeProducerSheets: true },
    userId,
  );
  const response = createTestResponse();
  const guard = registration.access.authorization;
  assert.ok(guard);
  const guardError = await invokeNextMiddleware(guard, req, response.res);
  if (guardError !== null) return errorResult(guardError);
  registration.handler(req, response.res, response.next);
  const handlerError = await response.completed;
  return handlerError === null ? response.result() : errorResult(handlerError);
}

function request(body: unknown, userId?: string): Request {
  return {
    body,
    headers: {},
    method: "POST",
    originalUrl: PAY_SHEET_CLOSE_PATH,
    params: { paySheetId: CLOSED_SHEET_ID },
    query: {},
    route: { path: PAY_SHEET_CLOSE_PATH },
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
