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
import type { AdminVocabularyManagementSource } from "../vocabulary/manage.js";
import { toErrorResponse } from "./errors.js";
import {
  ADMIN_VOCABULARY_PATH,
  ADMIN_VOCABULARY_STATE_PATH,
  registerAdminVocabularyRoutes,
  type RegisterAdminVocabularyRoutesOptions,
} from "./admin-vocabulary.js";
import type { RouteAccessDeclaration, RouteRegistrar } from "./routes.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000002";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000003";
const ITEM_ID = "00000000-0000-4000-8000-000000000010";
const logger: AppLogger = { error() {}, info() {}, warn() {} };

interface Registration {
  access: RouteAccessDeclaration;
  handler: RequestHandler;
  method: "GET" | "PUT";
  path: string;
}

test("admin vocabulary routes return only projected management fields", async () => {
  const fixture = createFixture();
  const listed = await invoke(fixture, "GET", "admin");
  const changed = await invoke(fixture, "PUT", "admin", { active: false });

  assert.equal(listed.status, 200);
  assert.equal(changed.status, 200);
  assert.equal(listed.headers["cache-control"], "no-store");
  assert.deepEqual(changed.body, source());
  assert.deepEqual(fixture.calls, [
    { operation: "list", userId: ADMIN_ID },
    {
      active: false,
      itemId: ITEM_ID,
      kind: "carrier",
      operation: "set",
      userId: ADMIN_ID,
    },
  ]);
  for (const forbidden of [
    "premiumTotal",
    "policyCount",
    "createdBy",
    "updatedAt",
  ]) {
    assert.equal(JSON.stringify(changed.body).includes(forbidden), false);
  }
});

test("employee, producer, and anonymous users receive no vocabulary payload", async () => {
  for (const identity of [undefined, "employee", "producer"] as const) {
    for (const method of ["GET", "PUT"] as const) {
      const fixture = createFixture();
      const response = await invoke(
        fixture,
        method,
        identity,
        method === "PUT" ? { active: false } : undefined,
      );
      assert.equal(response.status, identity === undefined ? 401 : 403);
      assert.deepEqual(fixture.calls, []);
      assert.equal(JSON.stringify(response.body).includes("Private Carrier"), false);
    }
  }
});

test("vocabulary management is explicitly guarded and rejects forged state", async () => {
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
        method: "GET",
        path: ADMIN_VOCABULARY_PATH,
        public: false,
      },
      {
        authorized: true,
        method: "PUT",
        path: ADMIN_VOCABULARY_STATE_PATH,
        public: false,
      },
    ],
  );
  for (const body of [
    { active: "false" },
    { active: false, actorUserId: ADMIN_ID },
    {},
  ]) {
    const fresh = createFixture();
    const response = await invoke(fresh, "PUT", "admin", body);
    assert.equal(response.status, 400);
    assert.deepEqual(fresh.calls, []);
  }

  const registration = fixture.registrations[1]!;
  const response = createTestResponse();
  registration.handler(request("PUT", { active: false }, ADMIN_ID), response.res, response.next);
  assert.equal(errorResult(await response.completed).status, 500);
  assert.deepEqual(fixture.calls, []);
});

function createFixture() {
  const users = new Map<string, UserAccount>([
    [ADMIN_ID, account(ADMIN_ID)],
    [EMPLOYEE_ID, account(EMPLOYEE_ID)],
    [PRODUCER_ID, account(PRODUCER_ID)],
  ]);
  const principals = new Map<string, AccessPrincipal>([
    [ADMIN_ID, principal(ADMIN_ID, { capabilities: ["admin"] })],
    [EMPLOYEE_ID, principal(EMPLOYEE_ID, { staffRole: "employee" })],
    [PRODUCER_ID, principal(PRODUCER_ID, { staffRole: "producer" })],
  ]);
  const authorization = createAuthorizationGuards({
    async findUser(userId) { return users.get(userId) ?? null; },
    async loadPrincipal(userId) { return principals.get(userId) ?? null; },
    logger,
  });
  const calls: Array<Record<string, unknown>> = [];
  const registrations: Registration[] = [];
  const options: RegisterAdminVocabularyRoutesOptions = {
    authorization,
    async list(context) {
      calls.push({ operation: "list", userId: context.principal.userId });
      return source();
    },
    logger,
    async setActive(context, kind, itemId, input) {
      calls.push({
        ...(input as Record<string, unknown>),
        itemId,
        kind,
        operation: "set",
        userId: context.principal.userId,
      });
      return source();
    },
  };
  const routes = {
    get(path: string, access: RouteAccessDeclaration, ...handlers: RequestHandler[]) {
      registrations.push({ access, handler: handlers[0]!, method: "GET", path });
    },
    put(path: string, access: RouteAccessDeclaration, ...handlers: RequestHandler[]) {
      registrations.push({ access, handler: handlers[0]!, method: "PUT", path });
    },
  } as unknown as RouteRegistrar;
  registerAdminVocabularyRoutes(routes, options);
  return { calls, registrations };
}

function source(): AdminVocabularyManagementSource {
  return {
    carriers: [
      { id: ITEM_ID, inUse: true, isActive: true, name: "Private Carrier" },
    ],
    mgas: [],
    policyTypes: [
      {
        classTag: "Commercial",
        id: ITEM_ID,
        inUse: false,
        isActive: true,
        name: "General Liability",
      },
    ],
  };
}

type Identity = "admin" | "employee" | "producer";

async function invoke(
  fixture: ReturnType<typeof createFixture>,
  method: "GET" | "PUT",
  identity?: Identity,
  body: unknown = {},
): Promise<TestResult> {
  const registration = fixture.registrations.find((item) => item.method === method)!;
  const userId = identity === "admin"
    ? ADMIN_ID
    : identity === "employee"
      ? EMPLOYEE_ID
      : identity === "producer"
        ? PRODUCER_ID
        : undefined;
  const req = request(method, body, userId);
  const response = createTestResponse();
  const guard = registration.access.authorization!;
  const guardError = await invokeMiddleware(guard, req, response.res);
  if (guardError !== null) return errorResult(guardError);
  registration.handler(req, response.res, response.next);
  const handlerError = await response.completed;
  return handlerError === null ? response.result() : errorResult(handlerError);
}

function request(method: "GET" | "PUT", body: unknown, userId?: string): Request {
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
    method,
    originalUrl: method === "GET" ? ADMIN_VOCABULARY_PATH : ADMIN_VOCABULARY_STATE_PATH,
    params: method === "GET" ? {} : { itemId: ITEM_ID, kind: "carrier" },
    query: {},
    route: { path: method === "GET" ? ADMIN_VOCABULARY_PATH : ADMIN_VOCABULARY_STATE_PATH },
    session,
  } as unknown as Request;
}

interface TestResult {
  body: unknown;
  headers: Record<string, string>;
  status: number;
}

function createTestResponse() {
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
    result: (): TestResult => ({ body, headers, status }),
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
  return { body: response.response, headers: {}, status: response.statusCode };
}

function account(id: string): UserAccount {
  return {
    createdAt: new Date("2026-07-14T00:00:00.000Z"),
    displayName: id,
    email: `${id}@example.test`,
    id,
    isActive: true,
    passwordChangeRequiredAt: null,
    sessionVersion: 0,
  };
}

function principal(
  userId: string,
  overrides: Partial<AccessPrincipal>,
): AccessPrincipal {
  return {
    capabilities: [],
    staffRole: null,
    userActive: true,
    userId,
    ...overrides,
  };
}
