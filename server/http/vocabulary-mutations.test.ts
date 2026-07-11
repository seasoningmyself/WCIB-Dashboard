import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import { createApp } from "../app.js";
import type { AccessPrincipal } from "../auth/access.js";
import { createAuthorizationGuards } from "../auth/authorization.js";
import type { UserAccount } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import { toErrorResponse } from "./errors.js";
import {
  auditRouteAccessDeclarations,
  type RouteAccessDeclaration,
  type RouteRegistrar,
} from "./routes.js";
import {
  CREATE_CARRIER_PATH,
  CREATE_POLICY_TYPE_PATH,
  createCarrierMutationHandler,
  registerVocabularyMutationRoutes,
  type RegisterVocabularyMutationRoutesOptions,
} from "./vocabulary.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000002";
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000003";
const UNASSIGNED_ID = "00000000-0000-4000-8000-000000000004";
const ITEM_ID = "00000000-0000-4000-8000-000000000010";

interface MutationCall {
  input: unknown;
  userId: string;
  vocabulary: "carrier" | "policy_type";
}

interface RegisteredPostRoute {
  access: RouteAccessDeclaration;
  handler: RequestHandler;
  path: string;
}

interface TestResult {
  body: unknown;
  headers: Record<string, string>;
  status: number;
}

const logger: AppLogger = { error() {}, info() {}, warn() {} };

function account(id: string): UserAccount {
  return {
    createdAt: new Date("2026-07-10T00:00:00.000Z"),
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

function createFixture() {
  const users = new Map<string, UserAccount>(
    [ADMIN_ID, PRODUCER_ID, EMPLOYEE_ID, UNASSIGNED_ID].map((id) => [
      id,
      account(id),
    ]),
  );
  const principals = new Map<string, AccessPrincipal>([
    [ADMIN_ID, principal(ADMIN_ID, { capabilities: ["admin"] })],
    [PRODUCER_ID, principal(PRODUCER_ID, { staffRole: "producer" })],
    [EMPLOYEE_ID, principal(EMPLOYEE_ID, { staffRole: "employee" })],
    [UNASSIGNED_ID, principal(UNASSIGNED_ID)],
  ]);
  const calls: MutationCall[] = [];
  const authorization = createAuthorizationGuards({
    async findUser(userId) {
      return users.get(userId) ?? null;
    },
    async loadPrincipal(userId) {
      return principals.get(userId) ?? null;
    },
    logger,
  });
  const options: RegisterVocabularyMutationRoutesOptions = {
    authorization,
    async createCarrier(context, input) {
      calls.push({
        input,
        userId: context.principal.userId,
        vocabulary: "carrier",
      });
      return {
        item: {
          createdBy: context.principal.userId,
          id: ITEM_ID,
          name: (input as { name: string }).name,
          policyCount: 9,
        },
        outcome:
          (input as { name: string }).name === "Existing Carrier"
            ? "duplicate"
            : "created",
      } as never;
    },
    async createPolicyType(context, input) {
      calls.push({
        input,
        userId: context.principal.userId,
        vocabulary: "policy_type",
      });
      return {
        item: {
          classTag: (input as { classTag: "Commercial" }).classTag,
          id: ITEM_ID,
          name: (input as { name: string }).name,
          premiumTotal: "1000.00",
        },
        outcome:
          (input as { name: string }).name === "Existing Policy Type"
            ? "duplicate"
            : "created",
      } as never;
    },
  };
  const registrations: RegisteredPostRoute[] = [];
  const routes = {
    post(
      path: string,
      access: RouteAccessDeclaration,
      ...handlers: RequestHandler[]
    ) {
      const handler = handlers[0];
      assert.ok(handler);
      registrations.push({ access, handler, path });
    },
  } as unknown as RouteRegistrar;
  registerVocabularyMutationRoutes(routes, options);
  return { calls, options, registrations, users };
}

test("carrier and policy-type creation accept every approved WCIB role", async () => {
  for (const [identity, userId] of [
    ["admin", ADMIN_ID],
    ["producer", PRODUCER_ID],
    ["employee", EMPLOYEE_ID],
  ] as const) {
    const fixture = createFixture();
    const carrier = await invokeRoute(
      fixture,
      CREATE_CARRIER_PATH,
      { name: "  Travelers  " },
      identity,
    );
    const policyType = await invokeRoute(
      fixture,
      CREATE_POLICY_TYPE_PATH,
      { classTag: "Commercial", name: "  General Liability  " },
      identity,
    );

    assert.equal(carrier.status, 201);
    assert.deepEqual(carrier.body, {
      item: { id: ITEM_ID, name: "Travelers" },
      outcome: "created",
    });
    assert.equal(policyType.status, 201);
    assert.deepEqual(policyType.body, {
      item: { classTag: "Commercial", id: ITEM_ID, name: "General Liability" },
      outcome: "created",
    });
    assert.equal(carrier.headers["cache-control"], "no-store");
    assert.deepEqual(fixture.calls, [
      { input: { name: "Travelers" }, userId, vocabulary: "carrier" },
      {
        input: { classTag: "Commercial", name: "General Liability" },
        userId,
        vocabulary: "policy_type",
      },
    ]);
  }
});

test("vocabulary creation returns picker-safe duplicate conflicts", async () => {
  const fixture = createFixture();
  const carrier = await invokeRoute(
    fixture,
    CREATE_CARRIER_PATH,
    { name: "Existing Carrier" },
    "employee",
  );
  const policyType = await invokeRoute(
    fixture,
    CREATE_POLICY_TYPE_PATH,
    { classTag: "Commercial", name: "Existing Policy Type" },
    "producer",
  );

  assert.equal(carrier.status, 409);
  assert.deepEqual(carrier.body, {
    item: { id: ITEM_ID, name: "Existing Carrier" },
    outcome: "duplicate",
  });
  assert.equal(policyType.status, 409);
  assert.deepEqual(policyType.body, {
    item: {
      classTag: "Commercial",
      id: ITEM_ID,
      name: "Existing Policy Type",
    },
    outcome: "duplicate",
  });
  const responseKeys = collectKeys([carrier.body, policyType.body]);
  for (const forbidden of [
    "auditMetadata",
    "commissionRate",
    "createdBy",
    "policyCount",
    "premiumTotal",
  ]) {
    assert.equal(responseKeys.has(forbidden), false, forbidden);
  }
});

test("vocabulary creation denies unauthenticated and default-deny users", async () => {
  const fixture = createFixture();
  const unauthenticated = await invokeRoute(
    fixture,
    CREATE_CARRIER_PATH,
    { name: "Carrier" },
  );
  const unassigned = await invokeRoute(
    fixture,
    CREATE_POLICY_TYPE_PATH,
    { classTag: "Commercial", name: "Policy Type" },
    "unassigned",
  );

  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(unauthenticated.body, {
    error: { code: "unauthorized", message: "Authentication required" },
  });
  assert.equal(unassigned.status, 403);
  assert.deepEqual(unassigned.body, {
    error: { code: "forbidden", message: "Forbidden" },
  });
  assert.deepEqual(fixture.calls, []);
});

test("vocabulary creation rejects invalid and forged request fields", async () => {
  const fixture = createFixture();
  for (const [path, body] of [
    [CREATE_CARRIER_PATH, { name: "   " }],
    [CREATE_CARRIER_PATH, { name: "x".repeat(201) }],
    [CREATE_CARRIER_PATH, { actorUserId: ADMIN_ID, name: "Carrier" }],
    [CREATE_POLICY_TYPE_PATH, { name: "Policy Type" }],
    [
      CREATE_POLICY_TYPE_PATH,
      { classTag: "Unknown", name: "Policy Type" },
    ],
  ] as const) {
    const response = await invokeRoute(fixture, path, body, "employee");
    assert.equal(response.status, 400);
    assert.equal(
      (response.body as { error: { code: string } }).error.code,
      "validation_error",
    );
  }
  assert.deepEqual(fixture.calls, []);
});

test("both mutation routes have explicit authorization declarations", () => {
  const fixture = createFixture();
  const app = createApp({
    registerRoutes(routes) {
      registerVocabularyMutationRoutes(routes, fixture.options);
    },
  });
  const declarations = auditRouteAccessDeclarations(app).filter(
    ({ path }) =>
      path === CREATE_CARRIER_PATH || path === CREATE_POLICY_TYPE_PATH,
  );

  assert.deepEqual(declarations, [
    {
      access: { type: "authorized" },
      method: "POST",
      path: CREATE_CARRIER_PATH,
    },
    {
      access: { type: "authorized" },
      method: "POST",
      path: CREATE_POLICY_TYPE_PATH,
    },
  ]);
});

test("mutation handler fails before writing when authorization is omitted", async () => {
  let calls = 0;
  const handler = createCarrierMutationHandler({
    async createCarrier() {
      calls += 1;
      return {
        item: { id: ITEM_ID, name: "Must not persist" },
        outcome: "created",
      };
    },
  });
  const result = await invokeHandlerWithoutGuard(handler, {
    name: "Must not persist",
  });

  assert.equal(result.status, 500);
  assert.equal(calls, 0);
  assert.deepEqual(result.body, {
    error: { code: "internal_error", message: "Internal server error" },
  });
});

async function invokeRoute(
  fixture: ReturnType<typeof createFixture>,
  path: string,
  body: unknown,
  identity?: "admin" | "employee" | "producer" | "unassigned",
): Promise<TestResult> {
  const registration = fixture.registrations.find(
    (candidate) => candidate.path === path,
  );
  assert.ok(registration);
  assert.equal(registration.access.public, undefined);
  const guard = registration.access.authorization;
  assert.ok(guard);

  const userId =
    identity === "admin"
      ? ADMIN_ID
      : identity === "producer"
        ? PRODUCER_ID
        : identity === "employee"
          ? EMPLOYEE_ID
          : identity === "unassigned"
            ? UNASSIGNED_ID
            : undefined;
  const req = {
    body,
    headers: {},
    method: "POST",
    originalUrl: path,
    route: { path },
    session: fakeSession(userId),
  } as unknown as Request;
  const response = createTestResponse();

  const guardError = await invokeNextMiddleware(guard, req, response.res);
  if (guardError !== null) {
    return errorResult(guardError);
  }

  registration.handler(req, response.res, response.next);
  const handlerError = await response.completed;
  return handlerError === null ? response.result() : errorResult(handlerError);
}

async function invokeHandlerWithoutGuard(
  handler: RequestHandler,
  body: unknown,
): Promise<TestResult> {
  const req = { body } as Request;
  const response = createTestResponse();
  handler(req, response.res, response.next);
  const error = await response.completed;
  return error === null ? response.result() : errorResult(error);
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
      return this;
    },
    json(value: unknown) {
      body = value;
      complete(null);
      return this;
    },
    locals: {},
    set(name: string, value: string) {
      headers[name.toLowerCase()] = value;
      return this;
    },
    status(value: number) {
      status = value;
      return this;
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

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, keys);
    }
    return keys;
  }
  if (value === null || typeof value !== "object") {
    return keys;
  }
  for (const [key, item] of Object.entries(value)) {
    keys.add(key);
    collectKeys(item, keys);
  }
  return keys;
}
