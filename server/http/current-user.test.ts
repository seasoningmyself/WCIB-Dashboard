import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import { test } from "node:test";
import type { Request, RequestHandler } from "express";
import { createApp } from "../app.js";
import type { AccessPrincipal } from "../auth/access.js";
import { createAuthorizationGuards } from "../auth/authorization.js";
import type { CurrentUserIdentity } from "../auth/current-user.js";
import type { UserAccount } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import { auditRouteAccessDeclarations } from "./routes.js";
import {
  CURRENT_USER_PATH,
  registerCurrentUserRoute,
} from "./current-user.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000002";
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000003";
const DISABLED_ID = "00000000-0000-4000-8000-000000000004";

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

interface TestResponse {
  body: unknown;
  headers: ReturnType<ServerResponse["getHeaders"]>;
  statusCode: number;
}

const logger: AppLogger = {
  error() {},
  info() {},
  warn() {},
};

function account(
  id: string,
  overrides: Partial<UserAccount> = {},
): UserAccount {
  return {
    createdAt: new Date("2026-07-09T00:00:00.000Z"),
    email: `${id}@example.test`,
    id,
    isActive: true,
    sessionVersion: 0,
    ...overrides,
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

function fakeSession(
  userId?: string,
  sessionVersion = 0,
): Request["session"] {
  const session = {
    cookie: {},
    destroy(callback: (error?: unknown) => void) {
      callback();
    },
  } as unknown as Request["session"];
  if (userId !== undefined) {
    session.userId = userId;
    session.sessionVersion = sessionVersion;
  }
  return session;
}

function createFixture() {
  const users = new Map<string, UserAccount>([
    [ADMIN_ID, account(ADMIN_ID)],
    [PRODUCER_ID, account(PRODUCER_ID)],
    [EMPLOYEE_ID, account(EMPLOYEE_ID)],
    [DISABLED_ID, account(DISABLED_ID, { isActive: false })],
  ]);
  const principals = new Map<string, AccessPrincipal>([
    [ADMIN_ID, principal(ADMIN_ID, { capabilities: ["admin"] })],
    [PRODUCER_ID, principal(PRODUCER_ID, { staffRole: "producer" })],
    [EMPLOYEE_ID, principal(EMPLOYEE_ID, { staffRole: "employee" })],
  ]);
  const identities = new Map<string, CurrentUserIdentity>([
    [
      ADMIN_ID,
      { displayName: "Sophia", email: "sophia@example.test", id: ADMIN_ID },
    ],
    [
      PRODUCER_ID,
      {
        displayName: "Kaylee",
        email: "kaylee@example.test",
        id: PRODUCER_ID,
      },
    ],
    [
      EMPLOYEE_ID,
      {
        displayName: "Mercedes",
        email: "mercedes@example.test",
        id: EMPLOYEE_ID,
      },
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
  const sessionMiddleware: RequestHandler = (req, _res, next) => {
    const identity = req.headers["x-test-identity"];
    const userId =
      identity === "admin" || identity === "expired"
        ? ADMIN_ID
        : identity === "producer"
          ? PRODUCER_ID
          : identity === "employee"
            ? EMPLOYEE_ID
            : identity === "disabled"
              ? DISABLED_ID
              : undefined;
    req.session = fakeSession(userId, identity === "expired" ? 99 : 0);
    next();
  };
  const app = createApp({
    registerRoutes(routes) {
      registerCurrentUserRoute(routes, {
        authorization,
        async loadIdentity(userId) {
          return identities.get(userId) ?? null;
        },
      });
    },
    sessionMiddleware,
  });
  return app;
}

test("GET /api/me returns exact server-derived role navigation", async () => {
  const app = createFixture();
  const admin = await request(app, `${CURRENT_USER_PATH}?role=producer`, {
    "x-claimed-capabilities": "producer",
    "x-claimed-role": "producer",
    "x-test-identity": "admin",
  });
  const producer = await request(app, CURRENT_USER_PATH, {
    "x-claimed-capabilities": "admin",
    "x-claimed-role": "admin",
    "x-test-identity": "producer",
  });
  const employee = await request(app, CURRENT_USER_PATH, {
    "x-test-identity": "employee",
  });

  assert.equal(admin.statusCode, 200);
  assert.deepEqual(admin.body, {
    user: {
      allowedNavigation: [
        "approvals",
        "help_requests",
        "policy_ledger",
        "mga_payables",
        "pay_sheets",
        "kpis",
        "manage_staff",
        "settings",
        "turn_in",
        "my_items",
      ],
      capabilities: ["admin"],
      displayName: "Sophia",
      email: "sophia@example.test",
      id: ADMIN_ID,
      role: "admin",
    },
  });
  assert.deepEqual(
    (producer.body as { user: { allowedNavigation: string[] } }).user
      .allowedNavigation,
    ["turn_in", "my_items", "my_commissions"],
  );
  assert.deepEqual(
    (employee.body as { user: { allowedNavigation: string[] } }).user
      .allowedNavigation,
    ["turn_in", "my_items"],
  );
  assert.equal(admin.headers["cache-control"], "no-store");

  for (const response of [admin, producer, employee]) {
    const keys = collectKeys(response.body);
    for (const forbidden of [
      "agencyGross",
      "agencyTotal",
      "basePremium",
      "collectedToDate",
      "commissionAmount",
      "commissionRate",
      "mgaId",
      "mgaPaid",
      "netDue",
      "netDueTotal",
      "passwordHash",
      "paySheetId",
      "premiumTotal",
      "resetToken",
      "sessionSecret",
    ]) {
      assert.equal(keys.has(forbidden), false, forbidden);
    }
  }
});

test("GET /api/me rejects missing, disabled, and expired sessions", async () => {
  const app = createFixture();

  for (const identity of [undefined, "disabled", "expired"]) {
    const response = await request(
      app,
      CURRENT_USER_PATH,
      identity === undefined ? {} : { "x-test-identity": identity },
    );
    assert.deepEqual(response.body, {
      error: { code: "unauthorized", message: "Authentication required" },
    });
    assert.equal(response.statusCode, 401);
    assert.equal("user" in (response.body as object), false);
  }
});

test("GET /api/me remains an explicitly authorized audited route", () => {
  const declaration = auditRouteAccessDeclarations(createFixture()).find(
    ({ method, path }) => method === "GET" && path === CURRENT_USER_PATH,
  );

  assert.deepEqual(declaration, {
    access: { type: "authorized" },
    method: "GET",
    path: CURRENT_USER_PATH,
  });
});

async function request(
  app: ReturnType<typeof createApp>,
  path: string,
  headers: Record<string, string>,
): Promise<TestResponse> {
  const socket = new MemorySocket();
  const nodeSocket = socket as unknown as Socket;
  const req = new IncomingMessage(nodeSocket);
  const res = new ServerResponse(req);
  req.method = "GET";
  req.url = path;
  req.headers = { host: "localhost", ...headers };
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
    headers: res.getHeaders(),
    statusCode: res.statusCode,
  };
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
