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
import { toErrorResponse } from "./errors.js";
import {
  IPFS_PRIOR_FINANCING_PATH,
  registerIpfsPriorFinancingRoute,
  type RegisterIpfsPriorFinancingRouteOptions,
} from "./ipfs.js";
import type {
  RouteAccessDeclaration,
  RouteRegistrar,
} from "./routes.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000002";
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000003";
const INACTIVE_ID = "00000000-0000-4000-8000-000000000004";
const FINANCED_AT = new Date("2026-07-01T12:00:00.000Z");
const logger: AppLogger = { error() {}, info() {}, warn() {} };

interface Registration {
  access: RouteAccessDeclaration;
  handler: RequestHandler;
  path: string;
}

interface TestResult {
  body: unknown;
  headers: Record<string, string>;
  status: number;
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
    [INACTIVE_ID, principal(INACTIVE_ID, { staffRole: "employee", userActive: false })],
  ]);
  const authorization = createAuthorizationGuards({
    async findUser(userId) { return users.get(userId) ?? null; },
    async loadPrincipal(userId) { return principals.get(userId) ?? null; },
    logger,
  });
  const calls: Array<{ insuredName: string; userId: string }> = [];
  const registrations: Registration[] = [];
  const options: RegisterIpfsPriorFinancingRouteOptions = {
    authorization,
    async find(context, insuredName) {
      calls.push({ insuredName, userId: context.principal.userId });
      return { priorFinancing: { approvedAt: FINANCED_AT } };
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
  registerIpfsPriorFinancingRoute(routes, options);
  return { calls, registrations };
}

test("IPFS history route returns one projected fact to every turn-in role", async () => {
  for (const identity of ["admin", "producer", "employee"] as const) {
    const fixture = createFixture();
    const result = await invoke(fixture, identity, { insuredName: "  Acme LLC  " });
    assert.equal(result.status, 200);
    assert.equal(result.headers["cache-control"], "no-store");
    assert.deepEqual(result.body, {
      priorFinancing: { lastFinancedAt: FINANCED_AT.toISOString() },
    });
    const serialized = JSON.stringify(result.body);
    for (const forbidden of [
      "policyId",
      "basePremium",
      "commissionAmount",
      "financeContact",
      "carrierId",
      "mgaId",
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
    assert.equal(fixture.calls[0]?.insuredName, "Acme LLC");
  }
});

test("IPFS history route rejects missing, inactive, and invalid callers before lookup", async () => {
  for (const identity of [undefined, "inactive"] as const) {
    const fixture = createFixture();
    const result = await invoke(fixture, identity, { insuredName: "Acme LLC" });
    assert.equal(result.status, 401);
    assert.deepEqual(fixture.calls, []);
    assert.equal(JSON.stringify(result.body).includes("Acme LLC"), false);
  }

  const invalid = createFixture();
  const result = await invoke(invalid, "employee", { insuredName: "" });
  assert.equal(result.status, 400);
  assert.deepEqual(invalid.calls, []);
});

test("IPFS history route declares authorization and fails closed without guard context", async () => {
  const fixture = createFixture();
  assert.equal(fixture.registrations.length, 1);
  const registration = fixture.registrations[0]!;
  assert.equal(registration.path, IPFS_PRIOR_FINANCING_PATH);
  assert.equal(typeof registration.access.authorization, "function");
  assert.equal("public" in registration.access, false);

  const response = createTestResponse();
  registration.handler(
    request({ insuredName: "Acme LLC" }),
    response.res,
    response.next,
  );
  const error = await response.completed;
  assert.notEqual(error, null);
  assert.equal(errorResult(error).status, 500);
  assert.deepEqual(fixture.calls, []);
});

type Identity = "admin" | "employee" | "producer" | "inactive";

async function invoke(
  fixture: ReturnType<typeof createFixture>,
  identity: Identity | undefined,
  query: unknown,
): Promise<TestResult> {
  const registration = fixture.registrations[0]!;
  const userId = identity === "admin"
    ? ADMIN_ID
    : identity === "employee"
      ? EMPLOYEE_ID
      : identity === "producer"
        ? PRODUCER_ID
        : identity === "inactive"
          ? INACTIVE_ID
          : undefined;
  const req = request(query, userId);
  const response = createTestResponse();
  const guard = registration.access.authorization;
  assert.ok(guard);
  const guardError = await invokeMiddleware(guard, req, response.res);
  if (guardError !== null) return errorResult(guardError);
  registration.handler(req, response.res, response.next);
  const handlerError = await response.completed;
  return handlerError === null ? response.result() : errorResult(handlerError);
}

function request(query: unknown, userId?: string): Request {
  const session = {
    cookie: {},
    destroy(callback: (error?: unknown) => void) { callback(); },
  } as unknown as Request["session"];
  if (userId !== undefined) {
    session.userId = userId;
    session.sessionVersion = 0;
  }
  return {
    headers: {},
    method: "GET",
    originalUrl: IPFS_PRIOR_FINANCING_PATH,
    params: {},
    query,
    route: { path: IPFS_PRIOR_FINANCING_PATH },
    session,
  } as unknown as Request;
}

function createTestResponse() {
  let status = 200;
  let body: unknown;
  const headers: Record<string, string> = {};
  let resolveCompleted!: (error: unknown | null) => void;
  const completed = new Promise<unknown | null>((resolve) => {
    resolveCompleted = resolve;
  });
  const res = {
    clearCookie() { return res; },
    locals: {},
    json(value: unknown) { body = value; resolveCompleted(null); return res; },
    set(name: string, value: string) { headers[name.toLowerCase()] = value; return res; },
    status(value: number) { status = value; return res; },
  } as unknown as Response;
  return {
    completed,
    next(error?: unknown) { resolveCompleted(error ?? null); },
    res,
    result: () => ({ body, headers, status }),
  };
}

async function invokeMiddleware(
  middleware: RequestHandler,
  req: Request,
  res: Response,
): Promise<unknown | null> {
  return new Promise((resolve) => {
    middleware(req, res, (error?: unknown) => resolve(error ?? null));
  });
}

function errorResult(error: unknown): TestResult {
  const result = toErrorResponse(error);
  return { body: result.response, headers: {}, status: result.statusCode };
}

function account(id: string, isActive = true): UserAccount {
  const at = new Date("2026-07-01T00:00:00.000Z");
  return { createdAt: at, email: `${id}@example.test`, id, isActive, sessionVersion: 0 };
}

function principal(id: string, access: Partial<AccessPrincipal> = {}): AccessPrincipal {
  return { capabilities: [], staffRole: null, userActive: true, userId: id, ...access };
}
