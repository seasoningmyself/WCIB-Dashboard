import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Express } from "express";
import * as databaseSchema from "../db/schema.js";
import { sessions, users } from "../db/schema.js";
import { createDatabasePool } from "../db/client.js";
import { createApp } from "../app.js";
import { asyncRoute } from "../http/errors.js";
import {
  createSessionMiddleware,
  establishAuthenticatedSession,
  resolveAuthenticatedSession,
  sessionRejectionReasons,
} from "./sessions.js";
import { createUser, findUserById } from "./users.js";

const SESSION_SECRET = "database-session-test-secret-at-least-32-characters";

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

function assertRejected(
  response: TestResponse,
  reason: (typeof sessionRejectionReasons)[keyof typeof sessionRejectionReasons],
): void {
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { authenticated: false, reason });
  assert.match(String(response.headers["set-cookie"]), /^wcib\.sid=;/);
}

test("Postgres sessions enforce identity lifecycle and minimal payloads", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for the session smoke test");

  const pool = createDatabasePool(databaseUrl);
  const database = drizzle(pool, { schema: databaseSchema });
  let userId: string | null = null;
  let userDeleted = false;

  try {
    const user = await createUser(database, {
      email: `session.${randomUUID()}@example.test`,
      password: "StrongPass123!",
    });
    userId = user.id;

    const app = createApp({
      registerRoutes(routes) {
        routes.post(
          "/test/authenticate",
          { public: true, reason: "Test Postgres session establishment" },
          asyncRoute(async (req, res) => {
            const account = await findUserById(database, user.id);
            if (account === null) {
              res.status(404).end();
              return;
            }
            await establishAuthenticatedSession(req, account);
            res.status(204).end();
          }),
        );
        routes.get(
          "/test/current",
          { public: true, reason: "Test Postgres session resolution" },
          asyncRoute(async (req, res) => {
            const result = await resolveAuthenticatedSession(
              req,
              res,
              (id) => findUserById(database, id),
            );
            if (!result.authenticated) {
              res.status(401).json(result);
              return;
            }
            res.json({
              sessionVersion: result.user.sessionVersion,
              userId: result.user.id,
            });
          }),
        );
      },
      sessionMiddleware: createSessionMiddleware(pool, {
        nodeEnv: "development",
        secret: SESSION_SECRET,
      }),
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
    assert.notEqual(secondCookie, firstCookie);

    assertRejected(
      await request(app, { cookie: firstCookie, path: "/test/current" }),
      sessionRejectionReasons.missingIdentity,
    );
    const current = await request(app, {
      cookie: secondCookie,
      path: "/test/current",
    });
    assert.equal(current.statusCode, 200);
    assert.deepEqual(current.body, { sessionVersion: 0, userId: user.id });

    const storedSessions = await database
      .select({ sess: sessions.sess })
      .from(sessions);
    const storedPayload = storedSessions
      .map((row) => row.sess as Record<string, unknown>)
      .find((payload) => payload.userId === user.id);
    assert.ok(storedPayload);
    assert.deepEqual(Object.keys(storedPayload).sort(), [
      "cookie",
      "sessionVersion",
      "userId",
    ]);

    await database
      .update(users)
      .set({ sessionVersion: 1 })
      .where(eq(users.id, user.id));
    assertRejected(
      await request(app, { cookie: secondCookie, path: "/test/current" }),
      sessionRejectionReasons.versionMismatch,
    );

    const activeLogin = await request(app, {
      method: "POST",
      path: "/test/authenticate",
    });
    await database
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, user.id));
    assertRejected(
      await request(app, {
        cookie: readCookie(activeLogin),
        path: "/test/current",
      }),
      sessionRejectionReasons.userDisabled,
    );

    await database
      .update(users)
      .set({ isActive: true })
      .where(eq(users.id, user.id));
    const expiringLogin = await request(app, {
      method: "POST",
      path: "/test/authenticate",
    });
    await pool.query(
      "update sessions set expire = now() - interval '1 second' where sess->>'userId' = $1",
      [user.id],
    );
    assertRejected(
      await request(app, {
        cookie: readCookie(expiringLogin),
        path: "/test/current",
      }),
      sessionRejectionReasons.missingIdentity,
    );

    const deletedUserLogin = await request(app, {
      method: "POST",
      path: "/test/authenticate",
    });
    await database.delete(users).where(eq(users.id, user.id));
    userDeleted = true;
    assertRejected(
      await request(app, {
        cookie: readCookie(deletedUserLogin),
        path: "/test/current",
      }),
      sessionRejectionReasons.userNotFound,
    );
  } finally {
    if (userId !== null) {
      await pool.query("delete from sessions where sess->>'userId' = $1", [
        userId,
      ]);
      if (!userDeleted) {
        await database.delete(users).where(eq(users.id, userId));
      }
    }
    await pool.end();
  }
});
