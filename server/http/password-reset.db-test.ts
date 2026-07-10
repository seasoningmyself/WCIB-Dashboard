import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Express } from "express";
import type pg from "pg";
import { createApp } from "../app.js";
import {
  hashPasswordResetToken,
  requestPasswordReset,
} from "../auth/password-reset.js";
import {
  unavailablePasswordResetDelivery,
  type PasswordResetDelivery,
  type PasswordResetDeliveryInput,
} from "../auth/password-reset-delivery.js";
import {
  createSessionMiddleware,
  resolveAuthenticatedSession,
} from "../auth/sessions.js";
import {
  createUser,
  findUserById,
  type AuthDatabase,
} from "../auth/users.js";
import { createDatabasePool } from "../db/client.js";
import * as databaseSchema from "../db/schema.js";
import {
  passwordResetTokens,
  sessions,
  users,
} from "../db/schema.js";
import { StructuredLogger } from "../logging/logger.js";
import { LOGIN_PATH, registerAuthRoutes } from "./auth.js";
import { asyncRoute } from "./errors.js";
import {
  PASSWORD_RESET_CONFIRM_PATH,
  PASSWORD_RESET_REQUEST_PATH,
} from "./password-reset.js";

const SESSION_SECRET =
  "database-password-reset-test-secret-at-least-32-characters";
const OLD_PASSWORD = "StrongPass123!";
const NEW_PASSWORD = "NewStrongPass456!";
const RESET_TEST_EMAIL_PATTERN =
  "^reset\\.[0-9a-f-]{36}@example\\.test$";

interface TestResponse {
  body: unknown;
  headers: Headers;
  statusCode: number;
}

async function startServer(app: Express): Promise<{
  baseUrl: string;
  server: Server;
}> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}`,
    server,
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }
      reject(error);
    });
  });
}

async function request(
  baseUrl: string,
  options: { body?: unknown; cookie?: string; method?: string; path: string },
): Promise<TestResponse> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (options.cookie !== undefined) {
    headers.cookie = options.cookie;
  }
  const response = await fetch(`${baseUrl}${options.path}`, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers,
    method: options.method ?? "GET",
  });
  const bodyText = await response.text();
  return {
    body: bodyText === "" ? null : JSON.parse(bodyText),
    headers: response.headers,
    statusCode: response.status,
  };
}

function readCookie(response: TestResponse): string {
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie !== null);
  return setCookie.split(";", 1)[0] ?? "";
}

function login(baseUrl: string, email: string, password: string) {
  return request(baseUrl, {
    body: { email, password },
    method: "POST",
    path: LOGIN_PATH,
  });
}

function requestReset(baseUrl: string, email: string) {
  return request(baseUrl, {
    body: { email },
    method: "POST",
    path: PASSWORD_RESET_REQUEST_PATH,
  });
}

function confirmReset(baseUrl: string, token: string, password: string) {
  return request(baseUrl, {
    body: { password, token },
    method: "POST",
    path: PASSWORD_RESET_CONFIRM_PATH,
  });
}

async function deleteResetTestUsers(
  database: AuthDatabase,
  pool: pg.Pool,
  userIds: readonly string[],
): Promise<void> {
  if (userIds.length === 0) {
    return;
  }
  await pool.query(
    "delete from sessions where sess->>'userId' = any($1::text[])",
    [userIds],
  );
  await database.delete(users).where(inArray(users.id, [...userIds]));
}

async function removeInterruptedResetTestData(
  database: AuthDatabase,
  pool: pg.Pool,
): Promise<void> {
  const result = await pool.query<{ id: string }>(
    "select id::text as id from users where email ~ $1",
    [RESET_TEST_EMAIL_PATTERN],
  );
  await deleteResetTestUsers(
    database,
    pool,
    result.rows.map((row) => row.id),
  );
}

test("password reset tokens are single-use and invalidate existing sessions", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for the reset smoke test");

  const pool = createDatabasePool(databaseUrl);
  const database = drizzle(pool, { schema: databaseSchema });
  const logger = new StructuredLogger({ write() {} });
  const deliveries: PasswordResetDeliveryInput[] = [];
  const delivery: PasswordResetDelivery = {
    async send(input) {
      deliveries.push(input);
    },
  };
  const userIds: string[] = [];
  let server: Server | null = null;

  try {
    await removeInterruptedResetTestData(database, pool);
    const runId = randomUUID();
    const user = await createUser(database, {
      email: `reset.${runId}@example.test`,
      password: OLD_PASSWORD,
    });
    userIds.push(user.id);

    const app = createApp({
      registerRoutes(routes) {
        registerAuthRoutes(routes, {
          database,
          logger,
          passwordResetDelivery: delivery,
        });
        routes.get(
          "/test/current-session",
          { public: true, reason: "Test reset session invalidation" },
          asyncRoute(async (req, res) => {
            const result = await resolveAuthenticatedSession(
              req,
              res,
              (id) => findUserById(database, id),
            );
            res.status(result.authenticated ? 200 : 401).json(result);
          }),
        );
      },
      sessionMiddleware: createSessionMiddleware(pool, {
        logger,
        nodeEnv: "development",
        secret: SESSION_SECRET,
      }),
    });
    const runningServer = await startServer(app);
    server = runningServer.server;

    const oldLogin = await login(
      runningServer.baseUrl,
      user.email,
      OLD_PASSWORD,
    );
    assert.equal(oldLogin.statusCode, 200);
    const oldCookie = readCookie(oldLogin);
    assert.equal(
      (
        await request(runningServer.baseUrl, {
          cookie: oldCookie,
          path: "/test/current-session",
        })
      ).statusCode,
      200,
    );

    const unknownRequest = await requestReset(
      runningServer.baseUrl,
      `unknown.${runId}@example.test`,
    );
    const knownRequest = await requestReset(runningServer.baseUrl, user.email);
    assert.deepEqual(unknownRequest.body, { status: "accepted" });
    assert.equal(knownRequest.statusCode, 202);
    assert.deepEqual(knownRequest.body, unknownRequest.body);
    assert.equal(deliveries.length, 1);
    const firstToken = deliveries[0]?.token;
    assert.ok(firstToken !== undefined);

    const [storedToken] = await database
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, user.id));
    assert.ok(storedToken);
    assert.equal(storedToken.tokenHash, hashPasswordResetToken(firstToken));
    assert.equal(storedToken.tokenHash.includes(firstToken), false);
    assert.equal(storedToken.consumedAt, null);

    const weakPassword = await confirmReset(
      runningServer.baseUrl,
      firstToken,
      "weak",
    );
    assert.equal(weakPassword.statusCode, 400);

    const confirmations = await Promise.all([
      confirmReset(runningServer.baseUrl, firstToken, NEW_PASSWORD),
      confirmReset(runningServer.baseUrl, firstToken, NEW_PASSWORD),
    ]);
    assert.deepEqual(
      confirmations.map((response) => response.statusCode).sort(),
      [204, 400],
    );
    const successfulConfirmation = confirmations.find(
      (response) => response.statusCode === 204,
    );
    assert.match(
      successfulConfirmation?.headers.get("set-cookie") ?? "",
      /^wcib\.sid=;/,
    );
    assert.equal(
      (
        await request(runningServer.baseUrl, {
          cookie: oldCookie,
          path: "/test/current-session",
        })
      ).statusCode,
      401,
    );

    const updatedUser = await findUserById(database, user.id);
    assert.ok(updatedUser);
    assert.equal(updatedUser.sessionVersion, 1);
    assert.equal(
      (await login(runningServer.baseUrl, user.email, OLD_PASSWORD)).statusCode,
      401,
    );
    assert.equal(
      (await login(runningServer.baseUrl, user.email, NEW_PASSWORD)).statusCode,
      200,
    );
    assert.equal(
      (
        await database
          .select()
          .from(sessions)
          .where(sql`${sessions.sess}->>'userId' = ${user.id}`)
      ).length,
      1,
    );

    const replay = await confirmReset(
      runningServer.baseUrl,
      firstToken,
      NEW_PASSWORD,
    );
    const invalid = await confirmReset(
      runningServer.baseUrl,
      "b".repeat(43),
      NEW_PASSWORD,
    );
    assert.equal(replay.statusCode, 400);
    assert.deepEqual(replay.body, invalid.body);

    await requestReset(runningServer.baseUrl, user.email);
    const expiringToken = deliveries[1]?.token;
    assert.ok(expiringToken !== undefined);
    await pool.query(
      "update password_reset_tokens set expires_at = created_at + interval '1 millisecond' where token_hash = $1",
      [hashPasswordResetToken(expiringToken)],
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(
      (
        await confirmReset(
          runningServer.baseUrl,
          expiringToken,
          NEW_PASSWORD,
        )
      ).statusCode,
      400,
    );

    await requestReset(runningServer.baseUrl, user.email);
    const disabledUserToken = deliveries[2]?.token;
    assert.ok(disabledUserToken !== undefined);
    await database
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, user.id));
    const deliveriesBeforeDisabledRequest = deliveries.length;
    assert.deepEqual(
      (await requestReset(runningServer.baseUrl, user.email)).body,
      unknownRequest.body,
    );
    assert.equal(deliveries.length, deliveriesBeforeDisabledRequest);
    assert.equal(
      (
        await confirmReset(
          runningServer.baseUrl,
          disabledUserToken,
          NEW_PASSWORD,
        )
      ).statusCode,
      400,
    );

    await database
      .update(users)
      .set({ isActive: true })
      .where(eq(users.id, user.id));
    assert.equal(
      (
        await confirmReset(
          runningServer.baseUrl,
          disabledUserToken,
          NEW_PASSWORD,
        )
      ).statusCode,
      400,
    );
    const unavailableResult = await requestPasswordReset(
      database,
      { email: user.email },
      unavailablePasswordResetDelivery,
    );
    assert.equal(unavailableResult.status, "delivery_failed");
    const activeTokens = await database
      .select({ id: passwordResetTokens.id })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          isNull(passwordResetTokens.consumedAt),
        ),
      );
    assert.equal(activeTokens.length, 0);
  } finally {
    if (server !== null) {
      await closeServer(server);
    }
    await deleteResetTestUsers(database, pool, userIds);
    await pool.end();
  }
});
