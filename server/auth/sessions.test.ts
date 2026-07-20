import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import { test } from "node:test";
import type { Express, Request, Response } from "express";
import session from "express-session";
import { createApp } from "../app.js";
import { asyncRoute } from "../http/errors.js";
import type { AppLogger, LogContext } from "../logging/logger.js";
import {
  establishAuthenticatedSession,
  destroyAuthenticatedSession,
  getSessionCookieOptions,
  resolveAuthenticatedSession,
  SESSION_COOKIE_NAME,
  sessionRejectionReasons,
} from "./sessions.js";
import type { UserAccount } from "./users.js";

const SESSION_SECRET = "unit-test-session-secret-at-least-32-characters";
const USER_ID = "00000000-0000-4000-8000-000000000001";

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

async function request(
  app: Express,
  options: { cookie?: string; method?: string; path: string },
): Promise<TestResponse> {
  const socket = new MemorySocket();
  const nodeSocket = socket as unknown as Socket;
  const req = new IncomingMessage(nodeSocket);
  const res = new ServerResponse(req);

  req.method = options.method ?? "GET";
  req.url = options.path;
  req.headers = {
    host: "localhost",
    ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
  };
  res.assignSocket(nodeSocket);

  const finished = new Promise<void>((resolve, reject) => {
    res.once("finish", resolve);
    res.once("error", reject);
  });

  app(req, res);
  await finished;

  const rawResponse = Buffer.concat(socket.chunks).toString("utf8");
  const bodyText = rawResponse.split("\r\n\r\n", 2)[1] ?? "";
  return {
    body: bodyText === "" ? null : JSON.parse(bodyText),
    headers: res.getHeaders(),
    statusCode: res.statusCode,
  };
}

function readCookie(response: TestResponse): string {
  const setCookie = response.headers["set-cookie"];
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  assert.ok(typeof header === "string");
  return header.split(";", 1)[0] ?? "";
}

function account(overrides: Partial<UserAccount> = {}): UserAccount {
  return {
    createdAt: new Date("2026-07-09T00:00:00.000Z"),
    displayName: "Session User",
    email: "session.user@example.test",
    id: USER_ID,
    isActive: true,
    passwordChangeRequiredAt: null,
    sessionVersion: 0,
    ...overrides,
  };
}

function memorySessionMiddleware() {
  return session({
    cookie: { httpOnly: true, sameSite: "lax", secure: false },
    name: SESSION_COOKIE_NAME,
    resave: false,
    saveUninitialized: false,
    secret: SESSION_SECRET,
  });
}

test("production session cookies require HTTPS", () => {
  assert.deepEqual(getSessionCookieOptions("production"), {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1_000,
    sameSite: "lax",
    secure: true,
  });
  assert.equal(getSessionCookieOptions("development").secure, false);
});

test("session destruction clears the WCIB cookie even when the store fails", async () => {
  const failure = new Error("session store unavailable");
  const clearedCookies: Array<{ name: string; path: string | undefined }> = [];
  const req = {
    session: {
      destroy(callback: (error?: Error) => void) {
        callback(failure);
      },
    },
  } as unknown as Request;
  const res = {
    clearCookie(name: string, options?: { path?: string }) {
      clearedCookies.push({ name, path: options?.path });
      return res;
    },
  } as unknown as Response;

  await assert.rejects(
    destroyAuthenticatedSession(req, res),
    failure,
  );
  assert.deepEqual(clearedCookies, [{ name: "wcib.sid", path: "/" }]);
});

test("session establishment regenerates identity and stores only WCIB auth state", async () => {
  const user = account();
  let sessionKeys: string[] = [];
  const app = createApp({
    registerRoutes(routes) {
      routes.post(
        "/test/authenticate",
        { public: true, reason: "Test session establishment" },
        asyncRoute(async (req, res) => {
          await establishAuthenticatedSession(req, user);
          sessionKeys = Object.keys(req.session).sort();
          res.status(204).end();
        }),
      );
      routes.get(
        "/test/current",
        { public: true, reason: "Test session resolution" },
        asyncRoute(async (req, res) => {
          const result = await resolveAuthenticatedSession(
            req,
            res,
            async () => user,
          );
          res.status(result.authenticated ? 200 : 401).json(result);
        }),
      );
    },
    sessionMiddleware: memorySessionMiddleware(),
  });

  const firstLogin = await request(app, {
    method: "POST",
    path: "/test/authenticate",
  });
  const firstCookie = readCookie(firstLogin);
  const secondLogin = await request(app, {
    cookie: firstCookie,
    method: "POST",
    path: "/test/authenticate",
  });
  const secondCookie = readCookie(secondLogin);

  assert.equal(firstLogin.statusCode, 204);
  assert.equal(secondLogin.statusCode, 204);
  assert.notEqual(secondCookie, firstCookie);
  assert.deepEqual(sessionKeys, ["cookie", "sessionVersion", "userId"]);
  assert.match(
    String(secondLogin.headers["set-cookie"]),
    /HttpOnly.*SameSite=Lax/,
  );

  const oldSession = await request(app, {
    cookie: firstCookie,
    path: "/test/current",
  });
  const currentSession = await request(app, {
    cookie: secondCookie,
    path: "/test/current",
  });
  assert.equal(oldSession.statusCode, 401);
  assert.deepEqual(oldSession.body, {
    authenticated: false,
    reason: sessionRejectionReasons.missingIdentity,
  });
  assert.equal(currentSession.statusCode, 200);
});

test("disabled and version-mismatched users are rejected with safe reason codes", async () => {
  let currentAccount = account();
  const logEvents: Array<{ context?: LogContext; message: string }> = [];
  const logger: AppLogger = {
    error() {},
    info() {},
    warn(message, context) {
      logEvents.push({ context, message });
    },
  };
  const app = createApp({
    registerRoutes(routes) {
      routes.post(
        "/test/authenticate",
        { public: true, reason: "Test session establishment" },
        asyncRoute(async (req, res) => {
          await establishAuthenticatedSession(req, account());
          res.status(204).end();
        }),
      );
      routes.get(
        "/test/current",
        { public: true, reason: "Test rejected sessions" },
        asyncRoute(async (req, res) => {
          const result = await resolveAuthenticatedSession(
            req,
            res,
            async () => currentAccount,
            logger,
          );
          res.status(result.authenticated ? 200 : 401).json(result);
        }),
      );
    },
    sessionMiddleware: memorySessionMiddleware(),
  });

  const disabledLogin = await request(app, {
    method: "POST",
    path: "/test/authenticate",
  });
  currentAccount = account({ isActive: false });
  const disabled = await request(app, {
    cookie: readCookie(disabledLogin),
    path: "/test/current",
  });
  assert.deepEqual(disabled.body, {
    authenticated: false,
    reason: sessionRejectionReasons.userDisabled,
  });

  currentAccount = account();
  const versionLogin = await request(app, {
    method: "POST",
    path: "/test/authenticate",
  });
  currentAccount = account({ sessionVersion: 1 });
  const versionMismatch = await request(app, {
    cookie: readCookie(versionLogin),
    path: "/test/current",
  });
  assert.deepEqual(versionMismatch.body, {
    authenticated: false,
    reason: sessionRejectionReasons.versionMismatch,
  });
  assert.deepEqual(logEvents, [
    {
      context: {
        component: "auth",
        event: "session_rejected",
        reason: sessionRejectionReasons.userDisabled,
      },
      message: "Session rejected",
    },
    {
      context: {
        component: "auth",
        event: "session_rejected",
        reason: sessionRejectionReasons.versionMismatch,
      },
      message: "Session rejected",
    },
  ]);
  assert.equal(JSON.stringify(logEvents).includes(USER_ID), false);
  assert.equal(JSON.stringify(logEvents).includes(currentAccount.email), false);
});

test("malformed session identity fails closed before user lookup", async () => {
  let lookups = 0;
  const app = createApp({
    registerRoutes(routes) {
      routes.post(
        "/test/malformed",
        { public: true, reason: "Test malformed session state" },
        (req, res) => {
          req.session.userId = "not-a-uuid";
          req.session.sessionVersion = 0;
          res.status(204).end();
        },
      );
      routes.get(
        "/test/current",
        { public: true, reason: "Test malformed session rejection" },
        asyncRoute(async (req, res) => {
          const result = await resolveAuthenticatedSession(req, res, async () => {
            lookups += 1;
            return account();
          });
          res.status(result.authenticated ? 200 : 401).json(result);
        }),
      );
    },
    sessionMiddleware: memorySessionMiddleware(),
  });

  const malformedLogin = await request(app, {
    method: "POST",
    path: "/test/malformed",
  });
  const result = await request(app, {
    cookie: readCookie(malformedLogin),
    path: "/test/current",
  });

  assert.equal(result.statusCode, 401);
  assert.deepEqual(result.body, {
    authenticated: false,
    reason: sessionRejectionReasons.invalidIdentity,
  });
  assert.equal(lookups, 0);
});
