import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import { test } from "node:test";
import type { Request, RequestHandler } from "express";
import type {
  AccessCapability,
  StaffRole,
} from "../../shared/access.js";
import { createApp } from "../app.js";
import type { AppLogger, LogContext } from "../logging/logger.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import type { AccessPrincipal } from "./access.js";
import {
  AUTHENTICATED_ACCESS,
  createAuthorizationGuards,
  type RouteAccessRequirement,
} from "./authorization.js";
import type { UserAccount } from "./users.js";

const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000002";
const ADMIN_ID = "00000000-0000-4000-8000-000000000003";

class MemorySocket extends Duplex {
  readonly chunks: Buffer[] = [];

  _read(): void {}

  _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding),
    );
    callback();
  }
}

interface RequestOptions {
  headers?: Record<string, string>;
  method?: string;
}

interface TestResponse {
  body: unknown;
  statusCode: number;
}

async function request(
  app: ReturnType<typeof createApp>,
  path: string,
  options: RequestOptions = {},
): Promise<TestResponse> {
  const socket = new MemorySocket();
  const nodeSocket = socket as unknown as Socket;
  const req = new IncomingMessage(nodeSocket);
  const res = new ServerResponse(req);

  req.method = options.method ?? "GET";
  req.url = path;
  req.headers = {
    host: "localhost",
    ...options.headers,
  };
  res.assignSocket(nodeSocket);

  const finished = new Promise<void>((resolve, reject) => {
    res.once("finish", resolve);
    res.once("error", reject);
  });

  app(req, res);
  await finished;

  const responseText = Buffer.concat(socket.chunks).toString("utf8");
  const responseBody = responseText.split("\r\n\r\n", 2)[1] ?? "";
  return {
    body: responseBody.length === 0 ? null : JSON.parse(responseBody),
    statusCode: res.statusCode,
  };
}

function account(id: string): UserAccount {
  return {
    createdAt: new Date("2026-07-09T00:00:00.000Z"),
    email: `${id}@example.test`,
    id,
    isActive: true,
    sessionVersion: 0,
  };
}

function principal(
  id: string,
  access: {
    capabilities?: readonly AccessCapability[];
    staffRole?: StaffRole | null;
  } = {},
): AccessPrincipal {
  return {
    capabilities: access.capabilities ?? [],
    staffRole: access.staffRole ?? null,
    userActive: true,
    userId: id,
  };
}

function recordingLogger(): {
  events: Array<{
    context?: LogContext;
    level: "error" | "info" | "warn";
    message: string;
  }>;
  logger: AppLogger;
} {
  const events: Array<{
    context?: LogContext;
    level: "error" | "info" | "warn";
    message: string;
  }> = [];
  return {
    events,
    logger: {
      error(message, context) {
        events.push({ context, level: "error", message });
      },
      info(message, context) {
        events.push({ context, level: "info", message });
      },
      warn(message, context) {
        events.push({ context, level: "warn", message });
      },
    },
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
  const { events, logger } = recordingLogger();
  const users = new Map([
    [EMPLOYEE_ID, account(EMPLOYEE_ID)],
    [PRODUCER_ID, account(PRODUCER_ID)],
    [ADMIN_ID, account(ADMIN_ID)],
  ]);
  const principals = new Map([
    [EMPLOYEE_ID, principal(EMPLOYEE_ID, { staffRole: "employee" })],
    [PRODUCER_ID, principal(PRODUCER_ID, { staffRole: "producer" })],
    [ADMIN_ID, principal(ADMIN_ID, { capabilities: ["admin"] })],
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
  let financialHandlerCalls = 0;
  let projectionCalls = 0;

  const sessionMiddleware: RequestHandler = (req, _res, next) => {
    const identity = req.headers["x-test-identity"];
    const userId =
      identity === "employee"
        ? EMPLOYEE_ID
        : identity === "producer"
          ? PRODUCER_ID
          : identity === "admin"
            ? ADMIN_ID
            : undefined;
    req.session = fakeSession(userId);
    next();
  };
  const app = createApp({
    logUnexpectedError() {},
    registerRoutes(expressApp) {
      expressApp.post(
        "/api/financial",
        authorization.require({
          capabilities: ["admin"],
          staffRoles: ["producer"],
        }),
        (_req, res) => {
          financialHandlerCalls += 1;
          const record = {
            agencyRevenue: 250,
            id: "policy-1",
            premiumTotal: 1_000,
            status: "bound",
          };
          const response = projectAuthorizedFields(
            res,
            record,
            (source, context) => {
              projectionCalls += 1;
              return context.principal.capabilities.includes("admin")
                ? {
                    agencyRevenue: source.agencyRevenue,
                    id: source.id,
                    premiumTotal: source.premiumTotal,
                    status: source.status,
                  }
                : { id: source.id, status: source.status };
            },
          );
          res.json(response);
        },
      );
      expressApp.get(
        "/api/authenticated",
        authorization.require(AUTHENTICATED_ACCESS),
        (_req, res) => {
          const response = projectAuthorizedFields(
            res,
            { value: "safe" },
            (source, context) => ({
              userId: context.principal.userId,
              value: source.value,
            }),
          );
          res.json(response);
        },
      );
      expressApp.get(
        "/api/default-deny",
        authorization.require(),
        (_req, res) => {
          res.json({ status: "must-not-run" });
        },
      );
      expressApp.get(
        "/api/unknown-access",
        authorization.require({
          capabilities: ["future_finance" as AccessCapability],
          staffRoles: ["manager" as StaffRole],
        }),
        (_req, res) => {
          res.json({ status: "must-not-run" });
        },
      );
      expressApp.get(
        "/api/malformed-access",
        authorization.require({
          staffRoles: "producer",
        } as unknown as RouteAccessRequirement),
        (_req, res) => {
          res.json({ status: "must-not-run" });
        },
      );
      expressApp.get("/api/unguarded-projection", (_req, res) => {
        const response = projectAuthorizedFields(
          res,
          { premiumTotal: 1_000 },
          (source) => {
            projectionCalls += 1;
            return source;
          },
        );
        res.json(response);
      });
    },
    sessionMiddleware,
  });

  return {
    app,
    events,
    getFinancialHandlerCalls: () => financialHandlerCalls,
    getProjectionCalls: () => projectionCalls,
  };
}

test("authorization middleware rejects missing, modified, and unknown access", async () => {
  const fixture = createFixture();
  const unauthenticated = await request(fixture.app, "/api/financial", {
    method: "POST",
  });
  const modifiedEmployee = await request(fixture.app, "/api/financial", {
    headers: {
      cookie: "wcib.sid=private-session-id",
      "x-claimed-capabilities": "admin",
      "x-claimed-staff-role": "producer",
      "x-financial-value": "must-not-be-logged",
      "x-test-identity": "employee",
    },
    method: "POST",
  });
  const defaultDeniedAdmin = await request(
    fixture.app,
    "/api/default-deny",
    { headers: { "x-test-identity": "admin" } },
  );
  const unknownDeniedAdmin = await request(
    fixture.app,
    "/api/unknown-access",
    { headers: { "x-test-identity": "admin" } },
  );
  const malformedDeniedProducer = await request(
    fixture.app,
    "/api/malformed-access",
    { headers: { "x-test-identity": "producer" } },
  );

  assert.deepEqual(unauthenticated, {
    body: {
      error: { code: "unauthorized", message: "Authentication required" },
    },
    statusCode: 401,
  });
  for (const response of [
    modifiedEmployee,
    defaultDeniedAdmin,
    unknownDeniedAdmin,
    malformedDeniedProducer,
  ]) {
    assert.deepEqual(response, {
      body: { error: { code: "forbidden", message: "Forbidden" } },
      statusCode: 403,
    });
  }
  assert.equal(fixture.getFinancialHandlerCalls(), 0);
  assert.equal(fixture.getProjectionCalls(), 0);

  const denialEvents = fixture.events.filter(
    (event) => event.context?.event === "authorization_denied",
  );
  assert.deepEqual(
    denialEvents.map((event) => event.context),
    [
      {
        component: "auth",
        event: "authorization_denied",
        method: "POST",
        reason: "unauthenticated",
        route: "/api/financial",
      },
      {
        component: "auth",
        event: "authorization_denied",
        method: "POST",
        reason: "missing_required_access",
        route: "/api/financial",
        userId: EMPLOYEE_ID,
      },
      {
        component: "auth",
        event: "authorization_denied",
        method: "GET",
        reason: "default_deny",
        route: "/api/default-deny",
        userId: ADMIN_ID,
      },
      {
        component: "auth",
        event: "authorization_denied",
        method: "GET",
        reason: "default_deny",
        route: "/api/unknown-access",
        userId: ADMIN_ID,
      },
      {
        component: "auth",
        event: "authorization_denied",
        method: "GET",
        reason: "default_deny",
        route: "/api/malformed-access",
        userId: PRODUCER_ID,
      },
    ],
  );
  const serializedEvents = JSON.stringify(fixture.events);
  for (const forbidden of [
    "private-session-id",
    "must-not-be-logged",
    "x-claimed-capabilities",
    "x-claimed-staff-role",
  ]) {
    assert.equal(serializedEvents.includes(forbidden), false);
  }
});

test("explicit guards establish trusted context for field projection", async () => {
  const fixture = createFixture();
  const producer = await request(fixture.app, "/api/financial", {
    headers: { "x-test-identity": "producer" },
    method: "POST",
  });
  const admin = await request(fixture.app, "/api/financial", {
    headers: { "x-test-identity": "admin" },
    method: "POST",
  });
  const employee = await request(fixture.app, "/api/authenticated", {
    headers: { "x-test-identity": "employee" },
  });

  assert.deepEqual(producer, {
    body: { id: "policy-1", status: "bound" },
    statusCode: 200,
  });
  assert.deepEqual(admin, {
    body: {
      agencyRevenue: 250,
      id: "policy-1",
      premiumTotal: 1_000,
      status: "bound",
    },
    statusCode: 200,
  });
  assert.deepEqual(employee, {
    body: { userId: EMPLOYEE_ID, value: "safe" },
    statusCode: 200,
  });
  assert.equal(fixture.getFinancialHandlerCalls(), 2);
  assert.equal(fixture.getProjectionCalls(), 2);
});

test("field projection fails closed when a route omits authorization", async () => {
  const fixture = createFixture();

  const response = await request(
    fixture.app,
    "/api/unguarded-projection",
  );

  assert.deepEqual(response, {
    body: {
      error: { code: "internal_error", message: "Internal server error" },
    },
    statusCode: 500,
  });
  assert.equal(fixture.getProjectionCalls(), 0);
});
