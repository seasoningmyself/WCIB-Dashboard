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
import { PaySheetAdjustmentNotFoundError } from "../pay-sheets/adjustment-target.js";
import {
  PaySheetNotFoundError,
  type PaySheetSource,
} from "../pay-sheets/read.js";
import { toErrorResponse } from "./errors.js";
import {
  PAY_SHEET_ADJUSTMENT_CREATE_PATH,
  PAY_SHEET_ADJUSTMENT_PATH,
  registerPaySheetAdjustmentRoutes,
  type RegisterPaySheetAdjustmentRoutesOptions,
} from "./pay-sheet-adjustments.js";
import type {
  RouteAccessDeclaration,
  RouteRegistrar,
} from "./routes.js";

const ADMIN_ID = uuid(1);
const PRODUCER_ID = uuid(2);
const EMPLOYEE_ID = uuid(3);
const INACTIVE_ID = uuid(4);
const PAY_SHEET_ID = uuid(10);
const ADJUSTMENT_ID = uuid(11);
const logger: AppLogger = { error() {}, info() {}, warn() {} };

type Method = "DELETE" | "POST" | "PUT";

interface Registration {
  access: RouteAccessDeclaration;
  handler: RequestHandler;
  method: Method;
  path: string;
}

function createFixture(options: {
  closed?: boolean;
  missingSheet?: boolean;
  missingTarget?: boolean;
  mutationError?: unknown;
  ownerType?: "producer" | "sophia";
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
  const calls: Array<{ kind: string; value: unknown }> = [];
  const registrations: Registration[] = [];
  let lastAction: "created" | "deleted" | "updated" | null = null;
  const ownerType = options.ownerType ?? "sophia";
  const status = options.closed ? "closed" : "open";
  const mutation = async (kind: "create" | "delete" | "update") => {
    if (options.mutationError !== undefined) throw options.mutationError;
    lastAction = `${kind}d` as "created" | "deleted" | "updated";
    return ADJUSTMENT_ID;
  };
  const routeOptions: RegisterPaySheetAdjustmentRoutesOptions = {
    authorization,
    async create(context, input) {
      calls.push({
        kind: "create",
        value: { input, userId: context.principal.userId },
      });
      return mutation("create");
    },
    async delete(context, adjustmentId) {
      calls.push({
        kind: "delete",
        value: { adjustmentId, userId: context.principal.userId },
      });
      return mutation("delete");
    },
    async getSheet(context, paySheetId) {
      calls.push({
        kind: "getSheet",
        value: { paySheetId, userId: context.principal.userId },
      });
      if (options.missingSheet) throw new PaySheetNotFoundError();
      return source({
        adjustmentPresent: lastAction !== "deleted",
        ownerType,
        status,
      });
    },
    async getTarget(context, adjustmentId) {
      calls.push({
        kind: "getTarget",
        value: { adjustmentId, userId: context.principal.userId },
      });
      if (options.missingTarget) {
        throw new PaySheetAdjustmentNotFoundError();
      }
      return { adjustmentId, ownerType, paySheetId: PAY_SHEET_ID, status };
    },
    logger,
    async update(context, adjustmentId, input) {
      calls.push({
        kind: "update",
        value: { adjustmentId, input, userId: context.principal.userId },
      });
      return mutation("update");
    },
  };
  const register = (
    method: Method,
    path: string,
    access: RouteAccessDeclaration,
    handlers: RequestHandler[],
  ) => {
    assert.ok(handlers[0]);
    registrations.push({ access, handler: handlers[0], method, path });
  };
  const routes = {
    delete(
      path: string,
      access: RouteAccessDeclaration,
      ...handlers: RequestHandler[]
    ) {
      register("DELETE", path, access, handlers);
    },
    post(
      path: string,
      access: RouteAccessDeclaration,
      ...handlers: RequestHandler[]
    ) {
      register("POST", path, access, handlers);
    },
    put(
      path: string,
      access: RouteAccessDeclaration,
      ...handlers: RequestHandler[]
    ) {
      register("PUT", path, access, handlers);
    },
  } as unknown as RouteRegistrar;
  registerPaySheetAdjustmentRoutes(routes, routeOptions);
  return { calls, registrations };
}

test("admin adjustment CRUD derives the sheet and returns projected state", async () => {
  const createFixtureState = createFixture();
  const created = await invoke(createFixtureState, "POST", {
    body: directIncome(),
    identity: "admin",
  });
  assert.equal(created.status, 200);
  assert.equal(created.headers["cache-control"], "no-store");
  assert.equal((created.body as any).mutation.action, "created");
  assert.equal((created.body as any).sheet.adjustments[0].id, ADJUSTMENT_ID);
  assert.equal(
    (created.body as any).sheet.totals.sophiaAgencyGross,
    "100.00",
  );
  const createCall = createFixtureState.calls.find(
    (call) => call.kind === "create",
  ) as any;
  assert.equal(createCall.value.input.paySheetId, PAY_SHEET_ID);
  assert.equal("createdByUserId" in createCall.value.input, false);
  assert.equal("createdAt" in createCall.value.input, false);

  const updateFixtureState = createFixture();
  const updated = await invoke(updateFixtureState, "PUT", {
    body: correction(),
    identity: "admin",
  });
  assert.equal(updated.status, 200);
  assert.equal((updated.body as any).mutation.action, "updated");
  const updateCall = updateFixtureState.calls.find(
    (call) => call.kind === "update",
  ) as any;
  assert.equal(updateCall.value.adjustmentId, ADJUSTMENT_ID);
  assert.equal(updateCall.value.input.paySheetId, PAY_SHEET_ID);

  const deleteFixtureState = createFixture();
  const deleted = await invoke(deleteFixtureState, "DELETE", {
    body: {},
    identity: "admin",
  });
  assert.equal(deleted.status, 200);
  assert.equal((deleted.body as any).mutation.action, "deleted");
  assert.equal((deleted.body as any).sheet.adjustments.length, 0);

  const serialized = JSON.stringify([
    created.body,
    updated.body,
    deleted.body,
  ]);
  for (const excluded of [
    "ownerEmail",
    "frozenTotals",
    "passwordHash",
    "privateDatabaseField",
  ]) {
    assert.equal(serialized.includes(`\"${excluded}\"`), false);
  }
});

test("update rejects cross-sheet and creation metadata before service access", async () => {
  for (const forged of [
    { paySheetId: uuid(99) },
    { createdAt: "2026-07-01T00:00:00.000Z" },
    { createdByUserId: ADMIN_ID },
    { id: uuid(98) },
  ]) {
    const fixture = createFixture();
    const result = await invoke(fixture, "PUT", {
      body: { ...correction(), ...forged },
      identity: "admin",
    });
    assert.equal(result.status, 400);
    assert.equal(fixture.calls.some((call) => call.kind === "update"), false);
  }
});

test("owner-specific validation rejects unsafe money before mutation", async () => {
  const producerDirect = createFixture({ ownerType: "producer" });
  const directResult = await invoke(producerDirect, "POST", {
    body: directIncome(),
    identity: "admin",
  });
  assert.equal(directResult.status, 400);
  assert.equal(producerDirect.calls.some((call) => call.kind === "create"), false);

  const producerCommission = createFixture({ ownerType: "producer" });
  const commissionResult = await invoke(producerCommission, "PUT", {
    body: correction({ commissionDelta: "-1.00" }),
    identity: "admin",
  });
  assert.equal(commissionResult.status, 400);
  assert.equal(
    producerCommission.calls.some((call) => call.kind === "update"),
    false,
  );

  const sophiaPayout = createFixture();
  const payoutResult = await invoke(sophiaPayout, "POST", {
    body: correction({ brokerFeeDelta: "0.00", payoutDelta: "-1.00" }),
    identity: "admin",
  });
  assert.equal(payoutResult.status, 400);
  assert.equal(sophiaPayout.calls.some((call) => call.kind === "create"), false);
});

test("closed sheets reject create, update, and delete before mutation", async () => {
  for (const method of ["POST", "PUT", "DELETE"] as const) {
    const fixture = createFixture({ closed: true });
    const result = await invoke(fixture, method, {
      body:
        method === "DELETE"
          ? {}
          : method === "POST"
            ? directIncome()
            : correction(),
      identity: "admin",
    });
    assert.equal(result.status, 409);
    assert.equal(
      fixture.calls.some((call) =>
        ["create", "delete", "update"].includes(call.kind),
      ),
      false,
    );
  }
});

test("employee, producer, inactive, and anonymous CRUD attempts cause no access", async () => {
  for (const identity of [
    undefined,
    "employee",
    "producer",
    "inactive",
  ] as const) {
    for (const method of ["POST", "PUT", "DELETE"] as const) {
      const fixture = createFixture();
      const result = await invoke(fixture, method, {
        body:
          method === "DELETE"
            ? {}
            : method === "POST"
              ? directIncome()
              : correction(),
        identity,
      });
      assert.equal(
        result.status,
        identity === undefined || identity === "inactive" ? 401 : 403,
      );
      assert.deepEqual(fixture.calls, []);
      assert.equal(JSON.stringify(result.body).includes("incomeAmount"), false);
    }
  }
});

test("constraint failures are minimal conflicts and do not trigger a refresh", async () => {
  for (const code of ["23503", "23514", "40001", "55000", "P0002"]) {
    const fixture = createFixture({
      mutationError: Object.assign(new Error("private adjustment detail"), {
        code,
      }),
    });
    const result = await invoke(fixture, "POST", {
      body: directIncome(),
      identity: "admin",
    });
    assert.equal(result.status, 409);
    assert.deepEqual(result.body, {
      error: {
        code: "bad_request",
        message: "Pay-sheet adjustment cannot be changed",
      },
    });
    assert.equal(
      fixture.calls.filter((call) => call.kind === "getSheet").length,
      1,
    );
  }
});

test("unknown sheet and stale adjustment IDs return minimal not-found errors", async () => {
  const missingSheet = createFixture({ missingSheet: true });
  const createResult = await invoke(missingSheet, "POST", {
    body: directIncome(),
    identity: "admin",
  });
  assert.equal(createResult.status, 404);
  assert.equal(missingSheet.calls.some((call) => call.kind === "create"), false);

  for (const method of ["PUT", "DELETE"] as const) {
    const missingTarget = createFixture({ missingTarget: true });
    const result = await invoke(missingTarget, method, {
      body: method === "DELETE" ? {} : correction(),
      identity: "admin",
    });
    assert.equal(result.status, 404);
    assert.equal(
      missingTarget.calls.some((call) =>
        ["delete", "update"].includes(call.kind),
      ),
      false,
    );
  }
});

test("all adjustment routes declare admin access and fail closed without context", async () => {
  const fixture = createFixture();
  assert.deepEqual(
    fixture.registrations.map(({ access, method, path }) => ({
      authorized: typeof access.authorization === "function",
      method,
      path,
      public: "public" in access,
    })),
    [
      {
        authorized: true,
        method: "POST",
        path: PAY_SHEET_ADJUSTMENT_CREATE_PATH,
        public: false,
      },
      {
        authorized: true,
        method: "PUT",
        path: PAY_SHEET_ADJUSTMENT_PATH,
        public: false,
      },
      {
        authorized: true,
        method: "DELETE",
        path: PAY_SHEET_ADJUSTMENT_PATH,
        public: false,
      },
    ],
  );
  for (const registration of fixture.registrations) {
    const response = createTestResponse();
    registration.handler(
      request(
        registration.method,
        registration.method === "DELETE"
          ? {}
          : registration.method === "POST"
            ? directIncome()
            : correction(),
        ADMIN_ID,
      ),
      response.res,
      response.next,
    );
    const error = await response.completed;
    assert.notEqual(error, null);
    assert.equal(errorResult(error).status, 500);
  }
  assert.deepEqual(fixture.calls, []);
});

function source(options: {
  adjustmentPresent: boolean;
  ownerType: "producer" | "sophia";
  status: "closed" | "open";
}): PaySheetSource {
  const at = new Date("2026-07-10T12:00:00.000Z");
  const isClosed = options.status === "closed";
  return {
    adjustments: options.adjustmentPresent
      ? [
          {
            adjustment: {
              accountBasis: "own",
              adjustmentType: "check_income",
              brokerFeeDelta: "0.00",
              commissionDelta: "0.00",
              createdAt: at,
              createdByUserId: ADMIN_ID,
              effectiveDate: "2026-07-10",
              id: ADJUSTMENT_ID,
              incomeAmount: "100.00",
              insuredOrClientLabel: "Private client label",
              paySheetId: PAY_SHEET_ID,
              payoutDelta: "0.00",
              policyTypeId: null,
              producerUserId: null,
              reasonOrNote: "Private note",
              sourceAdjustmentId: null,
              updatedAt: at,
            },
            policyTypeName: null,
            producerDisplayName: null,
          },
        ]
      : [],
    header: {
      ownerDisplayName: options.ownerType === "sophia" ? "Sophia" : "Kaylee",
      ownerEmail: "private-owner@example.test",
      sheet: {
        closedAt: isClosed ? at : null,
        closedByUserId: isClosed ? ADMIN_ID : null,
        createdAt: at,
        frozenTotals: isClosed
          ? options.ownerType === "sophia"
            ? sophiaTotals()
            : producerTotals()
          : null,
        id: PAY_SHEET_ID,
        openedAt: at,
        ownerType: options.ownerType,
        ownerUserId:
          options.ownerType === "sophia" ? ADMIN_ID : PRODUCER_ID,
        periodMonth: 7,
        periodYear: 2026,
        status: options.status,
        updatedAt: at,
      },
    },
    policies: [],
    rate: null,
  } as PaySheetSource;
}

function directIncome(overrides: Record<string, unknown> = {}) {
  return {
    accountBasis: "own",
    adjustmentType: "check_income",
    brokerFeeDelta: "0.00",
    commissionDelta: "0.00",
    effectiveDate: "2026-07-10",
    incomeAmount: "100.00",
    insuredOrClientLabel: "Client label",
    payoutDelta: "0.00",
    policyTypeId: null,
    producerUserId: null,
    reasonOrNote: "Payment note",
    ...overrides,
  };
}

function correction(overrides: Record<string, unknown> = {}) {
  return {
    accountBasis: "own",
    adjustmentType: "chargeback",
    brokerFeeDelta: "-10.00",
    commissionDelta: "0.00",
    effectiveDate: "2026-07-10",
    incomeAmount: "0.00",
    insuredOrClientLabel: "Client label",
    payoutDelta: "0.00",
    policyTypeId: null,
    producerUserId: null,
    reasonOrNote: "Correction note",
    ...overrides,
  };
}

function sophiaTotals() {
  return {
    brokerFees: "0.00",
    commissions: "0.00",
    directCheckAchIncome: "100.00",
    grandTotalIncome: "100.00",
    sophiaAgencyGross: "100.00",
    sophiaShare: "0.00",
    sophiaTakeHome: "100.00",
    trustPull: "0.00",
  };
}

function producerTotals() {
  return {
    brokerFees: "0.00",
    commissions: "0.00",
    directCheckAchIncome: "0.00",
    grandTotalIncome: "0.00",
    producerPayout: "0.00",
    trustPull: "0.00",
  };
}

type Identity = "admin" | "employee" | "producer" | "inactive";

async function invoke(
  fixture: ReturnType<typeof createFixture>,
  method: Method,
  options: { body: unknown; identity?: Identity },
): Promise<TestResult> {
  const path =
    method === "POST"
      ? PAY_SHEET_ADJUSTMENT_CREATE_PATH
      : PAY_SHEET_ADJUSTMENT_PATH;
  const registration = fixture.registrations.find(
    (candidate) => candidate.method === method && candidate.path === path,
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
  const req = request(method, options.body, userId);
  const response = createTestResponse();
  const guard = registration.access.authorization;
  assert.ok(guard);
  const guardError = await invokeNextMiddleware(guard, req, response.res);
  if (guardError !== null) return errorResult(guardError);
  registration.handler(req, response.res, response.next);
  const handlerError = await response.completed;
  return handlerError === null ? response.result() : errorResult(handlerError);
}

function request(method: Method, body: unknown, userId?: string): Request {
  const isCreate = method === "POST";
  return {
    body,
    headers: {},
    method,
    originalUrl: isCreate
      ? PAY_SHEET_ADJUSTMENT_CREATE_PATH
      : PAY_SHEET_ADJUSTMENT_PATH,
    params: isCreate
      ? { paySheetId: PAY_SHEET_ID }
      : { adjustmentId: ADJUSTMENT_ID },
    query: {},
    route: {
      path: isCreate
        ? PAY_SHEET_ADJUSTMENT_CREATE_PATH
        : PAY_SHEET_ADJUSTMENT_PATH,
    },
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
