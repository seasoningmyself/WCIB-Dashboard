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
  PAY_SHEET_BOOTSTRAP_PATH,
  registerPaySheetBootstrapRoute,
  type RegisterPaySheetBootstrapRouteOptions,
} from "./pay-sheet-bootstrap.js";
import type {
  RouteAccessDeclaration,
  RouteRegistrar,
} from "./routes.js";

const ADMIN_ID = uuid(1);
const PRODUCER_ID = uuid(2);
const EMPLOYEE_ID = uuid(3);
const SHEET_ID = uuid(10);
const logger: AppLogger = { error() {}, info() {}, warn() {} };

interface Registration {
  access: RouteAccessDeclaration;
  handler: RequestHandler;
  path: string;
}

function createFixture(bootstrapError?: unknown) {
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
  const calls: Array<{ kind: "bootstrap" | "get"; value: unknown }> = [];
  const registrations: Registration[] = [];
  const options: RegisterPaySheetBootstrapRouteOptions = {
    authorization,
    async bootstrap(context, input) {
      calls.push({
        kind: "bootstrap",
        value: { input, userId: context.principal.userId },
      });
      if (bootstrapError !== undefined) throw bootstrapError;
      return {
        created: true,
        ownerType: "sophia",
        paySheetId: SHEET_ID,
        periodMonth: 6,
        periodYear: 2026,
      };
    },
    async get(context, paySheetId) {
      calls.push({
        kind: "get",
        value: { paySheetId, userId: context.principal.userId },
      });
      return source();
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
  registerPaySheetBootstrapRoute(routes, options);
  return { calls, registrations };
}

test("admin bootstrap supplies a trusted actor and returns only projected data", async () => {
  const fixture = createFixture();
  const result = await invoke(fixture, "admin", {
    periodMonth: 6,
    periodYear: 2026,
  });
  assert.equal(result.status, 200);
  assert.equal(result.headers["cache-control"], "no-store");
  assert.deepEqual(fixture.calls, [
    {
      kind: "bootstrap",
      value: {
        input: { periodMonth: 6, periodYear: 2026 },
        userId: ADMIN_ID,
      },
    },
    { kind: "get", value: { paySheetId: SHEET_ID, userId: ADMIN_ID } },
  ]);
  const body = result.body as any;
  assert.equal(body.created, true);
  assert.equal(body.sheet.id, SHEET_ID);
  assert.equal(body.sheet.periodMonth, 6);
  assert.equal(body.sheet.periodYear, 2026);
  assert.equal(body.sheet.ownerType, "sophia");
  const serialized = JSON.stringify(body);
  for (const excluded of [
    "ownerEmail",
    "frozenTotals",
    "passwordHash",
    "databaseUrl",
  ]) {
    assert.equal(serialized.includes(`\"${excluded}\"`), false);
  }
});

test("bootstrap is admin-only, explicitly declared, and fails closed", async () => {
  for (const identity of [undefined, "employee", "producer"] as const) {
    const fixture = createFixture();
    const result = await invoke(fixture, identity, {
      periodMonth: 6,
      periodYear: 2026,
    });
    assert.equal(result.status, identity === undefined ? 401 : 403);
    assert.deepEqual(fixture.calls, []);
    assert.equal(JSON.stringify(result.body).includes(SHEET_ID), false);
  }

  const fixture = createFixture();
  assert.deepEqual(
    fixture.registrations.map(({ access, path }) => ({
      authorized: typeof access.authorization === "function",
      path,
      public: "public" in access,
    })),
    [{ authorized: true, path: PAY_SHEET_BOOTSTRAP_PATH, public: false }],
  );
  const registration = fixture.registrations[0];
  assert.ok(registration);
  const response = createTestResponse();
  registration.handler(
    request({ periodMonth: 6, periodYear: 2026 }, ADMIN_ID),
    response.res,
    response.next,
  );
  const error = await response.completed;
  assert.notEqual(error, null);
  assert.equal(errorResult(error).status, 500);
  assert.deepEqual(fixture.calls, []);
});

test("bootstrap rejects forged fields and maps integrity failures safely", async () => {
  for (const body of [
    { actorUserId: ADMIN_ID, periodMonth: 6, periodYear: 2026 },
    { periodMonth: 0, periodYear: 2026 },
    { periodMonth: 6, periodYear: 1999 },
  ]) {
    const fixture = createFixture();
    const result = await invoke(fixture, "admin", body);
    assert.equal(result.status, 400);
    assert.deepEqual(fixture.calls, []);
  }

  const fixture = createFixture(
    Object.assign(new Error("private database detail"), { code: "55000" }),
  );
  const result = await invoke(fixture, "admin", {
    periodMonth: 6,
    periodYear: 2026,
  });
  assert.equal(result.status, 409);
  assert.deepEqual(result.body, {
    error: {
      code: "bad_request",
      message: "Pay sheets are already initialized or unavailable",
    },
  });
  assert.equal(JSON.stringify(result.body).includes("database"), false);
  assert.equal(fixture.calls.filter(({ kind }) => kind === "get").length, 0);
});

function source(): PaySheetSource {
  const openedAt = new Date("2026-06-01T12:00:00.000Z");
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
        id: SHEET_ID,
        openedAt,
        ownerType: "sophia",
        ownerUserId: ADMIN_ID,
        periodMonth: 6,
        periodYear: 2026,
        status: "open",
        updatedAt: openedAt,
      },
    },
    policies: [],
    rate: null,
  };
}

type Identity = "admin" | "employee" | "producer";

async function invoke(
  fixture: ReturnType<typeof createFixture>,
  identity: Identity | undefined,
  body: unknown,
): Promise<TestResult> {
  const registration = fixture.registrations[0];
  assert.ok(registration);
  const userId =
    identity === "admin"
      ? ADMIN_ID
      : identity === "employee"
        ? EMPLOYEE_ID
        : identity === "producer"
          ? PRODUCER_ID
          : undefined;
  const req = request(body, userId);
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
    originalUrl: PAY_SHEET_BOOTSTRAP_PATH,
    params: {},
    query: {},
    route: { path: PAY_SHEET_BOOTSTRAP_PATH },
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

function account(id: string): UserAccount {
  return {
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    email: `${id}@example.test`,
    id,
    isActive: true,
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
