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
import type {
  PolicyChangeRequestRecord,
  PolicyRecord,
} from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import { PolicyLedgerCorrectionStaleError } from "../policies/ledger-corrections.js";
import type { AdminPolicyChangeRequestSource } from "../policy-change-requests/projection.js";
import { toErrorResponse } from "./errors.js";
import {
  CORRECT_POLICY_CHANGE_REQUEST_PATH,
  CREATE_POLICY_CHANGE_REQUEST_PATH,
  MY_POLICY_CHANGE_REQUESTS_PATH,
  registerPolicyChangeRequestRoutes,
  RESOLVE_POLICY_CHANGE_REQUEST_AS_IS_PATH,
  SEND_BACK_POLICY_CHANGE_REQUEST_PATH,
  type RegisterPolicyChangeRequestRoutesOptions,
} from "./policy-change-requests.js";
import type {
  RouteAccessDeclaration,
  RouteRegistrar,
} from "./routes.js";

const ADMIN_ID = uuid(1);
const PRODUCER_ID = uuid(2);
const EMPLOYEE_ID = uuid(3);
const UNASSIGNED_ID = uuid(4);
const INACTIVE_ID = uuid(5);
const POLICY_ID = uuid(10);
const REQUEST_ID = uuid(11);
const MUTATION_ID = uuid(12);
const AT = "2026-07-14T12:00:00.000Z";
const logger: AppLogger = { error() {}, info() {}, warn() {} };

type Method = "GET" | "PATCH" | "POST";

interface Registration {
  access: RouteAccessDeclaration;
  handler: RequestHandler;
  method: Method;
  path: string;
}

function createFixture(options: { correctionError?: Error } = {}) {
  const users = new Map<string, UserAccount>([
    [ADMIN_ID, account(ADMIN_ID)],
    [PRODUCER_ID, account(PRODUCER_ID)],
    [EMPLOYEE_ID, account(EMPLOYEE_ID)],
    [UNASSIGNED_ID, account(UNASSIGNED_ID)],
    [INACTIVE_ID, account(INACTIVE_ID, false)],
  ]);
  const principals = new Map<string, AccessPrincipal>([
    [ADMIN_ID, principal(ADMIN_ID, { capabilities: ["admin"] })],
    [PRODUCER_ID, principal(PRODUCER_ID, { staffRole: "producer" })],
    [EMPLOYEE_ID, principal(EMPLOYEE_ID, { staffRole: "employee" })],
    [UNASSIGNED_ID, principal(UNASSIGNED_ID)],
    [INACTIVE_ID, principal(INACTIVE_ID, { staffRole: "employee", userActive: false })],
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
  const calls: Array<{ action: string; input?: unknown; userId: string }> = [];
  const registrations: Registration[] = [];
  const route = (method: Method) =>
    (
      path: string,
      access: RouteAccessDeclaration,
      ...handlers: RequestHandler[]
    ) => {
      assert.ok(handlers[0]);
      registrations.push({ access, handler: handlers[0], method, path });
    };
  const routes = {
    get: route("GET"),
    patch: route("PATCH"),
    post: route("POST"),
  } as unknown as RouteRegistrar;
  const config: RegisterPolicyChangeRequestRoutesOptions = {
    authorization,
    async correct(context, _requestId, input) {
      calls.push({ action: "correct", input, userId: context.principal.userId });
      if (options.correctionError !== undefined) throw options.correctionError;
      return {
        policy: { id: POLICY_ID } as PolicyRecord,
        source: adminSource("corrected"),
      };
    },
    async create(context, _policyId, input) {
      calls.push({ action: "create", input, userId: context.principal.userId });
      return record(context.principal.userId);
    },
    async listMine(context) {
      calls.push({ action: "list", userId: context.principal.userId });
      return [record(context.principal.userId)];
    },
    logger,
    async resolveAsIs(context) {
      calls.push({ action: "as_is", userId: context.principal.userId });
      return adminSource("as_is");
    },
    async sendBack(context, _requestId, input) {
      calls.push({ action: "send_back", input, userId: context.principal.userId });
      return adminSource("sent_back");
    },
  };
  registerPolicyChangeRequestRoutes(routes, config);
  return { calls, registrations };
}

test("all change-request routes declare explicit owner or admin guards", () => {
  const fixture = createFixture();
  assert.deepEqual(
    fixture.registrations.map(({ method, path }) => ({ method, path })),
    [
      { method: "POST", path: CREATE_POLICY_CHANGE_REQUEST_PATH },
      { method: "GET", path: MY_POLICY_CHANGE_REQUESTS_PATH },
      { method: "PATCH", path: CORRECT_POLICY_CHANGE_REQUEST_PATH },
      { method: "POST", path: RESOLVE_POLICY_CHANGE_REQUEST_AS_IS_PATH },
      { method: "POST", path: SEND_BACK_POLICY_CHANGE_REQUEST_PATH },
    ],
  );
  for (const registration of fixture.registrations) {
    assert.equal(typeof registration.access.authorization, "function");
    assert.equal("public" in registration.access, false);
  }
});

test("employee and producer owners receive reason-only projected request data", async () => {
  for (const identity of ["employee", "producer"] as const) {
    const createFixtureResult = createFixture();
    const created = await invoke(
      createFixtureResult,
      "POST",
      CREATE_POLICY_CHANGE_REQUEST_PATH,
      { reason: "Please review this approved policy." },
      identity,
    );
    assert.equal(created.status, 201);
    assert.equal(created.headers["cache-control"], "no-store");
    assertOwnerProjection(created.body);
    assert.deepEqual(createFixtureResult.calls, [
      {
        action: "create",
        input: { reason: "Please review this approved policy." },
        userId: identity === "employee" ? EMPLOYEE_ID : PRODUCER_ID,
      },
    ]);

    const listFixture = createFixture();
    const listed = await invoke(
      listFixture,
      "GET",
      MY_POLICY_CHANGE_REQUESTS_PATH,
      undefined,
      identity,
    );
    assert.equal(listed.status, 200);
    const requests = (listed.body as { requests: unknown[] }).requests;
    assert.equal(requests.length, 1);
    assertOwnerProjection({ request: requests[0] });
  }
});

test("admin resolves only through guarded as-is, send-back, and correction routes", async () => {
  for (const [method, path, body, action] of [
    ["POST", RESOLVE_POLICY_CHANGE_REQUEST_AS_IS_PATH, {}, "as_is"],
    [
      "POST",
      SEND_BACK_POLICY_CHANGE_REQUEST_PATH,
      { reason: "No correction is needed." },
      "send_back",
    ],
    ["PATCH", CORRECT_POLICY_CHANGE_REQUEST_PATH, correctionBody(), "correct"],
  ] as const) {
    const fixture = createFixture();
    const response = await invoke(fixture, method, path, body, "admin");
    assert.equal(response.status, 200);
    const serialized = JSON.stringify(response.body);
    assert.match(serialized, /Canonical Insured/);
    assert.match(serialized, /CHANGE-001/);
    assert.equal(serialized.includes("basePremium"), false);
    assert.equal(serialized.includes("commissionAmount"), false);
    assert.equal(serialized.includes("netDue"), false);
    assert.equal(fixture.calls[0]?.action, action);
    assert.equal(fixture.calls[0]?.userId, ADMIN_ID);
  }
});

test("wrong roles are denied before every owner and admin handler", async () => {
  const cases: Array<{
    allowed: readonly Identity[];
    body: unknown;
    method: Method;
    path: string;
  }> = [
    {
      allowed: ["employee", "producer"],
      body: { reason: "Review" },
      method: "POST",
      path: CREATE_POLICY_CHANGE_REQUEST_PATH,
    },
    {
      allowed: ["employee", "producer"],
      body: undefined,
      method: "GET",
      path: MY_POLICY_CHANGE_REQUESTS_PATH,
    },
    {
      allowed: ["admin"],
      body: correctionBody(),
      method: "PATCH",
      path: CORRECT_POLICY_CHANGE_REQUEST_PATH,
    },
    {
      allowed: ["admin"],
      body: {},
      method: "POST",
      path: RESOLVE_POLICY_CHANGE_REQUEST_AS_IS_PATH,
    },
    {
      allowed: ["admin"],
      body: { reason: "No change" },
      method: "POST",
      path: SEND_BACK_POLICY_CHANGE_REQUEST_PATH,
    },
  ];

  for (const route of cases) {
    for (const identity of [
      undefined,
      "admin",
      "employee",
      "producer",
      "unassigned",
      "inactive",
    ] as const) {
      if (identity !== undefined && route.allowed.includes(identity)) continue;
      const fixture = createFixture();
      const response = await invoke(
        fixture,
        route.method,
        route.path,
        route.body,
        identity,
      );
      assert.equal(
        response.status,
        identity === undefined || identity === "inactive" ? 401 : 403,
      );
      assert.deepEqual(fixture.calls, []);
      assert.equal(JSON.stringify(response.body).includes(POLICY_ID), false);
    }
  }
});

test("reason-only input and stale correction failures stay fail-closed", async () => {
  const forged = createFixture();
  const forgedResponse = await invoke(
    forged,
    "POST",
    CREATE_POLICY_CHANGE_REQUEST_PATH,
    { brokerFee: "0.00", reason: "Try to mutate" },
    "employee",
  );
  assert.equal(forgedResponse.status, 400);
  assert.deepEqual(forged.calls, []);

  const stale = createFixture({
    correctionError: new PolicyLedgerCorrectionStaleError(),
  });
  const staleResponse = await invoke(
    stale,
    "PATCH",
    CORRECT_POLICY_CHANGE_REQUEST_PATH,
    correctionBody(),
    "admin",
  );
  assert.equal(staleResponse.status, 409);
  assert.equal(
    (staleResponse.body as any).error.message,
    "Policy changed while the request was open",
  );

  const registration = createFixture().registrations[0]!;
  const response = createTestResponse();
  registration.handler(
    request("POST", CREATE_POLICY_CHANGE_REQUEST_PATH, { reason: "Review" }, EMPLOYEE_ID),
    response.res,
    response.next,
  );
  const error = await response.completed;
  assert.notEqual(error, null);
  assert.equal(errorResult(error).status, 500);
});

function assertOwnerProjection(body: unknown): void {
  const request = (body as { request: Record<string, unknown> }).request;
  assert.equal(request.id, REQUEST_ID);
  assert.equal(request.policyId, POLICY_ID);
  assert.equal(request.reason, "Please review this approved policy.");
  for (const field of [
    "requestedByUserId",
    "resolvedByUserId",
    "mutationId",
    "mutationKind",
    "basePremium",
    "brokerFee",
    "commissionAmount",
    "netDue",
    "producerPayout",
  ]) {
    assert.equal(field in request, false, field);
  }
}

function record(requestedByUserId: string): PolicyChangeRequestRecord {
  const at = new Date(AT);
  return {
    id: REQUEST_ID,
    mutationId: null,
    mutationKind: null,
    policyId: POLICY_ID,
    reason: "Please review this approved policy.",
    requestedAt: at,
    requestedByUserId,
    resolution: null,
    resolutionReason: null,
    resolvedAt: null,
    resolvedByUserId: null,
    status: "pending",
  };
}

function adminSource(
  resolution: "as_is" | "corrected" | "sent_back",
): AdminPolicyChangeRequestSource {
  const base = record(EMPLOYEE_ID);
  return {
    insuredName: "Canonical Insured",
    policyNumber: "CHANGE-001",
    requesterDisplayName: "Policy Owner",
    request: {
      ...base,
      mutationId: resolution === "corrected" ? MUTATION_ID : null,
      mutationKind: resolution === "corrected" ? "general" : null,
      resolution,
      resolutionReason: resolution === "sent_back" ? "No correction is needed." : null,
      resolvedAt: new Date(AT),
      resolvedByUserId: ADMIN_ID,
      status: resolution === "sent_back" ? "rejected" : "resolved",
    },
  };
}

function correctionBody() {
  return {
    change: {
      changedFields: ["insuredName"],
      reason: "Correct the approved insured name",
      replacementValues: { insuredName: "Corrected Insured" },
    },
    expectedUpdatedAt: AT,
    kind: "general",
  } as const;
}

type Identity = "admin" | "employee" | "inactive" | "producer" | "unassigned";

async function invoke(
  fixture: ReturnType<typeof createFixture>,
  method: Method,
  path: string,
  body: unknown,
  identity?: Identity,
): Promise<TestResult> {
  const registration = fixture.registrations.find(
    (candidate) => candidate.method === method && candidate.path === path,
  );
  assert.ok(registration);
  const userId =
    identity === "admin"
      ? ADMIN_ID
      : identity === "employee"
        ? EMPLOYEE_ID
        : identity === "producer"
          ? PRODUCER_ID
          : identity === "unassigned"
            ? UNASSIGNED_ID
            : identity === "inactive"
              ? INACTIVE_ID
              : undefined;
  const req = request(method, path, body, userId);
  const response = createTestResponse();
  const guard = registration.access.authorization;
  assert.ok(guard);
  const guardError = await invokeNextMiddleware(guard, req, response.res);
  if (guardError !== null) return errorResult(guardError);
  registration.handler(req, response.res, response.next);
  const handlerError = await response.completed;
  return handlerError === null ? response.result() : errorResult(handlerError);
}

function request(
  method: Method,
  path: string,
  body: unknown,
  userId?: string,
): Request {
  return {
    body,
    headers: {},
    method,
    originalUrl: path,
    params: path === CREATE_POLICY_CHANGE_REQUEST_PATH
      ? { policyId: POLICY_ID }
      : { requestId: REQUEST_ID },
    query: {},
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
    json(value: unknown) {
      body = value;
      resolveCompleted(null);
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
  return { body: response.response, headers: {}, status: response.statusCode };
}

function account(id: string, isActive = true): UserAccount {
  return {
    createdAt: new Date(AT),
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
  access: Partial<AccessPrincipal> = {},
): AccessPrincipal {
  return {
    capabilities: [],
    staffRole: null,
    userActive: true,
    userId,
    ...access,
  };
}

function uuid(suffix: number): string {
  return `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}
