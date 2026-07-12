import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import { test } from "node:test";
import type { Request, RequestHandler } from "express";
import { createApp } from "../app.js";
import type { AccessPrincipal } from "../auth/access.js";
import { createAuthorizationGuards } from "../auth/authorization.js";
import type { UserAccount } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import type { ActiveVocabularySource } from "../vocabulary/active.js";
import { auditRouteAccessDeclarations } from "./routes.js";
import {
  ACTIVE_VOCABULARY_PATH,
  createActiveVocabularyHandler,
  registerActiveVocabularyRoute,
} from "./vocabulary.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000002";
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000003";
const UNASSIGNED_ID = "00000000-0000-4000-8000-000000000004";
const OPTION_ID = "00000000-0000-4000-8000-000000000010";

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

interface LoggedEvent {
  context?: Record<string, unknown>;
  message: string;
}

const source = {
  carriers: [
    {
      createdAt: "must not leak",
      id: OPTION_ID,
      isActive: true,
      name: "Travelers",
      policyCount: 4,
    },
  ],
  mgas: [
    {
      auditMetadata: "must not leak",
      id: OPTION_ID,
      name: "RPS",
      netDue: "100.00",
    },
  ],
  officeMode: { activeCount: 1, kind: "single", soleOfficeId: OPTION_ID },
  officeLocations: [
    { id: OPTION_ID, name: "Chicago", premiumTotal: "1000.00" },
  ],
  policyTypes: [
    {
      classTag: "Commercial",
      commissionRate: "0.25",
      id: OPTION_ID,
      name: "General Liability",
    },
  ],
} as unknown as ActiveVocabularySource;

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

function createFixture(
  vocabulary: ActiveVocabularySource = source,
): { app: ReturnType<typeof createApp>; events: LoggedEvent[] } {
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
  const events: LoggedEvent[] = [];
  const logger: AppLogger = {
    error() {},
    info(message, context) {
      events.push({ context, message });
    },
    warn() {},
  };
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
      identity === "admin"
        ? ADMIN_ID
        : identity === "producer"
          ? PRODUCER_ID
          : identity === "employee"
            ? EMPLOYEE_ID
            : identity === "unassigned"
              ? UNASSIGNED_ID
              : undefined;
    req.session = fakeSession(userId);
    next();
  };
  const app = createApp({
    registerRoutes(routes) {
      registerActiveVocabularyRoute(routes, {
        authorization,
        async load() {
          return vocabulary;
        },
        logger,
      });
    },
    sessionMiddleware,
  });
  return { app, events };
}

test("GET /api/vocabulary returns the same exact contract to all WCIB roles", async () => {
  const expected = {
    carriers: [{ id: OPTION_ID, name: "Travelers" }],
    mgas: [{ id: OPTION_ID, name: "RPS" }],
    officeMode: { activeCount: 1, kind: "single", soleOfficeId: OPTION_ID },
    officeLocations: [{ id: OPTION_ID, name: "Chicago" }],
    policyTypes: [
      { classTag: "Commercial", id: OPTION_ID, name: "General Liability" },
    ],
  };

  for (const identity of ["admin", "producer", "employee"]) {
    const fixture = createFixture();
    const response = await request(fixture.app, {
      "x-test-identity": identity,
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, expected);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.deepEqual(fixture.events, [
      {
        context: {
          carrierCount: 1,
          component: "vocabulary",
          event: "active_vocabulary_read",
          mgaCount: 1,
          officeLocationCount: 1,
          policyTypeCount: 1,
        },
        message: "Active vocabulary loaded",
      },
    ]);
  }

  const keys = collectKeys(expected);
  for (const forbidden of [
    "auditMetadata",
    "commissionAmount",
    "commissionRate",
    "createdAt",
    "isActive",
    "netDue",
    "policyCount",
    "premiumTotal",
    "updatedAt",
  ]) {
    assert.equal(keys.has(forbidden), false, forbidden);
  }
});

test("GET /api/vocabulary rejects unauthenticated and default-deny users", async () => {
  const fixture = createFixture();
  const unauthenticated = await request(fixture.app);
  const unassigned = await request(fixture.app, {
    "x-test-identity": "unassigned",
  });

  assert.equal(unauthenticated.statusCode, 401);
  assert.deepEqual(unauthenticated.body, {
    error: { code: "unauthorized", message: "Authentication required" },
  });
  assert.equal(unassigned.statusCode, 403);
  assert.deepEqual(unassigned.body, {
    error: { code: "forbidden", message: "Forbidden" },
  });
  assert.deepEqual(fixture.events, []);
});

test("GET /api/vocabulary supports a blank WCIB vocabulary", async () => {
  const fixture = createFixture({
    carriers: [],
    mgas: [],
    officeMode: { activeCount: 0, kind: "unconfigured", soleOfficeId: null },
    officeLocations: [],
    policyTypes: [],
  });
  const response = await request(fixture.app, {
    "x-test-identity": "employee",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    carriers: [],
    mgas: [],
    officeMode: { activeCount: 0, kind: "unconfigured", soleOfficeId: null },
    officeLocations: [],
    policyTypes: [],
  });
});

test("active vocabulary route has an explicit authorization declaration", () => {
  const declaration = auditRouteAccessDeclarations(createFixture().app).find(
    ({ method, path }) => method === "GET" && path === ACTIVE_VOCABULARY_PATH,
  );

  assert.deepEqual(declaration, {
    access: { type: "authorized" },
    method: "GET",
    path: ACTIVE_VOCABULARY_PATH,
  });
});

test("active vocabulary projection fails closed without an authorization guard", async () => {
  const logger: AppLogger = { error() {}, info() {}, warn() {} };
  const app = createApp({
    logUnexpectedError() {},
    registerRoutes(routes) {
      routes.get(
        ACTIVE_VOCABULARY_PATH,
        {
          public: true,
          reason: "Test-only proof that projection still requires auth context",
        },
        createActiveVocabularyHandler({
          async load() {
            return source;
          },
          logger,
        }),
      );
    },
  });
  const response = await request(app);

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, {
    error: { code: "internal_error", message: "Internal server error" },
  });
  assert.equal(JSON.stringify(response.body).includes("Travelers"), false);
});

async function request(
  app: ReturnType<typeof createApp>,
  headers: Record<string, string> = {},
): Promise<TestResponse> {
  const socket = new MemorySocket();
  const nodeSocket = socket as unknown as Socket;
  const req = new IncomingMessage(nodeSocket);
  const res = new ServerResponse(req);
  req.method = "GET";
  req.url = ACTIVE_VOCABULARY_PATH;
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
