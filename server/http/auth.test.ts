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
    email: "admin@example.test",
    id: USER_ID,
    isActive: true,
    sessionVersion: 0,
    ...overrides,
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
): Promise<HandlerResponse> {
  return new Promise<HandlerResponse>((resolve, reject) => {
    let statusCode = 200;
    const req = { body } as Request;
    const res = {
      end() {
        resolve({ body: null, statusCode });
        return res;
      },
      json(responseBody: unknown) {
        resolve({ body: responseBody, statusCode });
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
      return account();
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
      return account();
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

test("malformed login requests use the shared validation error", async () => {
  const { logger } = recordingLogger();
  let attempts = 0;
  const handler = createLoginHandler({
    async authenticate() {
      attempts += 1;
      return account();
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
