import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import type { AccessPrincipal } from "../auth/access.js";
import type { AuthDatabase, UserAccount } from "../auth/users.js";
import type { AppLogger, LogContext } from "../logging/logger.js";
import {
  createLoginHandler,
  createLogoutHandler,
  LOGIN_PATH,
  LOGOUT_PATH,
  registerAuthRoutes,
} from "./auth.js";
import { toErrorResponse } from "./errors.js";
import type {
  RouteAccessDeclaration,
  RouteRegistrar,
} from "./routes.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";

interface HandlerResponse {
  body: unknown;
  statusCode: number;
}

function account(overrides: Partial<UserAccount> = {}): UserAccount {
  return {
    createdAt: new Date("2026-07-09T00:00:00.000Z"),
    displayName: "Admin User",
    email: "admin@example.test",
    id: USER_ID,
    isActive: true,
    passwordChangeRequiredAt: null,
    sessionVersion: 0,
    ...overrides,
  };
}

function authenticated() {
  return {
    account: account(),
    verifiedPasswordHash: "$2b$10$DA2BkeOLidNMTWnMvpyAj.I9tWFMwSTWG4LihsLTuEj.F/uK./VMq",
  };
}

function principal(overrides: Partial<AccessPrincipal> = {}): AccessPrincipal {
  return {
    capabilities: [],
    staffRole: null,
    userActive: true,
    userId: USER_ID,
    ...overrides,
  };
}

function recordingLogger() {
  const events: Array<{
    context?: LogContext;
    level: "error" | "info" | "warn";
    message: string;
  }> = [];
  const logger: AppLogger = {
    error(message, context) {
      events.push({ context, level: "error", message });
    },
    info(message, context) {
      events.push({ context, level: "info", message });
    },
    warn(message, context) {
      events.push({ context, level: "warn", message });
    },
  };
  return { events, logger };
}

async function invokeHandler(
  handler: RequestHandler,
  body: unknown,
  responseHeaders: Record<string, string> = {},
): Promise<HandlerResponse> {
  return new Promise<HandlerResponse>((resolve, reject) => {
    let statusCode = 200;
    const req = {
      body,
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
    } as Request;
    const res = {
      end() {
        resolve({ body: null, statusCode });
        return res;
      },
      json(responseBody: unknown) {
        resolve({ body: responseBody, statusCode });
        return res;
      },
      set(name: string, value: string) {
        responseHeaders[name.toLowerCase()] = value;
        return res;
      },
      status(nextStatusCode: number) {
        statusCode = nextStatusCode;
        return res;
      },
    } as unknown as Response;
    const next: NextFunction = (error?: unknown) => {
      if (error === undefined) {
        reject(new Error("Login handler called next without an error"));
        return;
      }
      const result = toErrorResponse(error);
      resolve({ body: result.response, statusCode: result.statusCode });
    };

    handler(req, res, next);
  });
}

test("login returns only the safe WCIB identity and access summary", async () => {
  const { events, logger } = recordingLogger();
  let establishedSessions = 0;
  const handler = createLoginHandler({
    async authenticate() {
      return authenticated();
    },
    async establishSession(_req, user) {
      establishedSessions += 1;
      assert.equal(user.id, USER_ID);
    },
    async loadPrincipal() {
      return principal({ capabilities: ["admin"] });
    },
    logger,
  });

  const response = await invokeHandler(handler, {
    email: "  ADMIN@EXAMPLE.TEST ",
    password: "StrongPass123!",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    authenticationState: "authenticated",
    user: {
      capabilities: ["admin"],
      email: "admin@example.test",
      id: USER_ID,
      staffRole: null,
    },
  });
  assert.equal(establishedSessions, 1);
  assert.deepEqual(events, [
    {
      context: {
        component: "auth",
        event: "login_succeeded",
        userId: USER_ID,
      },
      level: "info",
      message: "Login succeeded",
    },
  ]);
  const serialized = JSON.stringify(response.body);
  for (const forbidden of [
    "password",
    "sessionVersion",
    "isActive",
    "organization",
    "driver",
    "customer",
    "mfa",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("an enrolled account receives only an MFA challenge session after a valid password", async () => {
  const { logger } = recordingLogger();
  let authenticatedSessions = 0;
  let challengeSessions = 0;
  let clearedFailures = 0;
  const handler = createLoginHandler({
    async authenticate() {
      return authenticated();
    },
    async establishMfaSession(_req, user, state) {
      assert.equal(user.id, USER_ID);
      assert.equal(state, "mfa_challenge");
      challengeSessions += 1;
    },
    async establishSession() {
      authenticatedSessions += 1;
    },
    async loadMfaState() {
      return {
        activeMethodCount: 1,
        enrolled: true,
        enrollmentIncomplete: false,
        enforcementEnabled: true,
        policyRequired: false,
        recoveryCodesAcknowledged: true,
        requiresMfaLogin: true,
      };
    },
    async loadPrincipal() {
      return principal({ capabilities: ["admin"] });
    },
    logger,
    throttle: {
      async check() {
        return null;
      },
      async clearAccount() {
        clearedFailures += 1;
      },
      async recordFailure() {
        return null;
      },
    },
  });

  const response = await invokeHandler(handler, {
    email: "admin@example.test",
    password: "StrongPass123!",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    authenticationState: "mfa_required",
    user: {
      capabilities: ["admin"],
      email: "admin@example.test",
      id: USER_ID,
      staffRole: null,
    },
  });
  assert.equal(authenticatedSessions, 0);
  assert.equal(challengeSessions, 1);
  assert.equal(clearedFailures, 0);
});

test("required password replacement takes precedence over an enrolled MFA challenge", async () => {
  const { logger } = recordingLogger();
  let authenticatedSessions = 0;
  let mfaSessions = 0;
  const handler = createLoginHandler({
    async authenticate() {
      return {
        ...authenticated(),
        account: account({
          passwordChangeRequiredAt: new Date("2026-07-21T12:00:00.000Z"),
        }),
      };
    },
    async establishMfaSession() {
      mfaSessions += 1;
    },
    async establishSession() {
      authenticatedSessions += 1;
    },
    async loadMfaState() {
      return {
        activeMethodCount: 1,
        enrolled: true,
        enrollmentIncomplete: false,
        enforcementEnabled: true,
        policyRequired: false,
        recoveryCodesAcknowledged: true,
        requiresMfaLogin: true,
      };
    },
    async loadPrincipal() {
      return principal({ capabilities: ["admin"] });
    },
    logger,
  });

  const response = await invokeHandler(handler, {
    email: "admin@example.test",
    password: "Temporary harbor 72!",
  });

  assert.equal(response.statusCode, 200);
  assert.equal((response.body as any).authenticationState, "authenticated");
  assert.equal(authenticatedSessions, 1);
  assert.equal(mfaSessions, 0);
});

test("invalid and unavailable identities share one non-enumerating response", async () => {
  const { events, logger } = recordingLogger();
  let attempts = 0;
  const invalidHandler = createLoginHandler({
    async authenticate() {
      attempts += 1;
      return null;
    },
    async establishSession() {
      throw new Error("A failed login must not establish a session");
    },
    async loadPrincipal() {
      throw new Error("A failed login must not load access");
    },
    logger,
  });
  const unavailableHandler = createLoginHandler({
    async authenticate() {
      return authenticated();
    },
    async establishSession() {
      throw new Error("An unavailable identity must not establish a session");
    },
    async loadPrincipal() {
      return null;
    },
    logger,
  });
  const body = { email: "user@example.test", password: "wrong-password" };

  const firstInvalid = await invokeHandler(invalidHandler, body);
  const secondInvalid = await invokeHandler(invalidHandler, body);
  const unavailable = await invokeHandler(unavailableHandler, body);

  assert.deepEqual(firstInvalid, secondInvalid);
  assert.deepEqual(firstInvalid, unavailable);
  assert.deepEqual(firstInvalid, {
    body: {
      error: {
        code: "invalid_credentials",
        message: "Invalid email or password",
      },
    },
    statusCode: 401,
  });
  assert.equal(attempts, 2);
  assert.equal(JSON.stringify(events).includes(body.email), false);
  assert.equal(JSON.stringify(events).includes(body.password), false);
});

test("temporary login throttling is enumeration-safe and supplies Retry-After", async () => {
  const { events, logger } = recordingLogger();
  const headers: Record<string, string> = {};
  let authenticationCalls = 0;
  const handler = createLoginHandler({
    async authenticate() {
      authenticationCalls += 1;
      return null;
    },
    async establishSession() {
      throw new Error("A throttled login must not establish a session");
    },
    async loadPrincipal() {
      throw new Error("A throttled login must not load access");
    },
    logger,
    throttle: {
      async check() {
        return { kind: "account", retryAfterSeconds: 120 };
      },
      async clearAccount() {},
      async recordFailure() {
        throw new Error("An active cooldown must not record another failure");
      },
    },
  });

  const knownShape = await invokeHandler(
    handler,
    { email: "known@example.test", password: "wrong-password" },
    headers,
  );
  const unknownShape = await invokeHandler(
    handler,
    { email: "unknown@example.test", password: "wrong-password" },
  );

  assert.deepEqual(knownShape, unknownShape);
  assert.deepEqual(knownShape, {
    body: {
      error: {
        code: "too_many_attempts",
        message: "Too many attempts. Try again in 2 minutes.",
      },
    },
    statusCode: 429,
  });
  assert.equal(headers["retry-after"], "120");
  assert.equal(authenticationCalls, 0);
  assert.equal(JSON.stringify(events).includes("known@example.test"), false);
  assert.equal(JSON.stringify(events).includes("unknown@example.test"), false);
});

test("successful login clears account failures and deferred hash upgrades cannot lock out", async () => {
  const { events, logger } = recordingLogger();
  const clearedAccounts: string[] = [];
  let establishedSessions = 0;
  const handler = createLoginHandler({
    async authenticate() {
      return authenticated();
    },
    async establishSession() {
      establishedSessions += 1;
    },
    async loadPrincipal() {
      return principal();
    },
    logger,
    throttle: {
      async check() {
        return null;
      },
      async clearAccount(accountEmail) {
        clearedAccounts.push(accountEmail);
      },
      async recordFailure() {
        return null;
      },
    },
    async upgradePasswordHash() {
      throw new Error("simulated rehash outage");
    },
  });

  const response = await invokeHandler(handler, {
    email: "  ADMIN@EXAMPLE.TEST ",
    password: "StrongPass123!",
  });

  assert.equal(response.statusCode, 200);
  assert.equal(establishedSessions, 1);
  assert.deepEqual(clearedAccounts, ["admin@example.test"]);
  assert.ok(
    events.some(
      ({ context }) => context?.event === "password_hash_upgrade_deferred",
    ),
  );
  assert.ok(
    events.some(({ context }) => context?.event === "login_succeeded"),
  );
});

test("malformed login requests use the shared validation error", async () => {
  const { logger } = recordingLogger();
  let attempts = 0;
  const handler = createLoginHandler({
    async authenticate() {
      attempts += 1;
      return authenticated();
    },
    async establishSession() {},
    async loadPrincipal() {
      return principal();
    },
    logger,
  });

  const response = await invokeHandler(handler, {
    email: "not-an-email",
    organizationId: "dumpster-domain-field",
    password: "StrongPass123!",
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, {
    error: {
      code: "validation_error",
      details: [
        { field: "email", message: "Email must be valid" },
        { field: "request", message: "Unrecognized key(s) in object: 'organizationId'" },
      ],
      message: "Request validation failed",
    },
  });
  assert.equal(attempts, 0);
});

test("logout is idempotent and returns an empty safe response", async () => {
  const { events, logger } = recordingLogger();
  let destroyedSessions = 0;
  const handler = createLogoutHandler({
    async destroySession() {
      destroyedSessions += 1;
    },
    logger,
  });

  const first = await invokeHandler(handler, undefined);
  const second = await invokeHandler(handler, undefined);

  assert.deepEqual(first, { body: null, statusCode: 204 });
  assert.deepEqual(second, first);
  assert.equal(destroyedSessions, 2);
  assert.deepEqual(events, [
    {
      context: { component: "auth", event: "logout_succeeded" },
      level: "info",
      message: "Logout succeeded",
    },
    {
      context: { component: "auth", event: "logout_succeeded" },
      level: "info",
      message: "Logout succeeded",
    },
  ]);
});

test("logout destruction failures use the generic API error", async () => {
  const { events, logger } = recordingLogger();
  const handler = createLogoutHandler({
    async destroySession() {
      throw new Error("cookie=must-not-reach-the-response");
    },
    logger,
  });

  const response = await invokeHandler(handler, undefined);

  assert.deepEqual(response, {
    body: {
      error: {
        code: "internal_error",
        message: "Internal server error",
      },
    },
    statusCode: 500,
  });
  assert.deepEqual(events, [
    {
      context: { component: "auth", event: "logout_failed" },
      level: "error",
      message: "Logout failed",
    },
  ]);
  assert.equal(JSON.stringify(response).includes("must-not"), false);
});

test("login middleware has an explicit insertion point and no active default", () => {
  const { logger } = recordingLogger();
  const routeRegistrations: Array<{
    access: RouteAccessDeclaration;
    handlers: RequestHandler[];
    path: string;
  }> = [];
  const routes = {
    post(
      path: string,
      access: RouteAccessDeclaration,
      ...handlers: RequestHandler[]
    ) {
      routeRegistrations.push({ access, handlers, path });
    },
  } as unknown as RouteRegistrar;
  const rateLimiter: RequestHandler = (_req, _res, next) => next();
  const database = {} as AuthDatabase;

  registerAuthRoutes(routes, { database, logger });
  registerAuthRoutes(routes, {
    database,
    logger,
    loginMiddleware: [rateLimiter],
  });

  const loginRegistrations = routeRegistrations.filter(
    (registration) => registration.path === LOGIN_PATH,
  );
  const logoutRegistrations = routeRegistrations.filter(
    (registration) => registration.path === LOGOUT_PATH,
  );
  assert.equal(loginRegistrations[0]?.handlers.length, 1);
  assert.equal(loginRegistrations[1]?.handlers.length, 2);
  assert.equal(loginRegistrations[1]?.handlers[0], rateLimiter);
  assert.equal(loginRegistrations[0]?.access.public, true);
  assert.equal(logoutRegistrations.length, 2);
  assert.equal(logoutRegistrations[0]?.handlers.length, 1);
  assert.equal(logoutRegistrations[0]?.access.public, true);
});
