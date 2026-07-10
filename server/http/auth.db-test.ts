import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Express } from "express";
import type pg from "pg";
import { createApp } from "../app.js";
import { createSessionMiddleware } from "../auth/sessions.js";
import { createUser, type AuthDatabase } from "../auth/users.js";
import { createDatabasePool } from "../db/client.js";
import * as databaseSchema from "../db/schema.js";
import {
  sessions,
  staffProfiles,
  userCapabilities,
  users,
} from "../db/schema.js";
import { StructuredLogger } from "../logging/logger.js";
import { LOGIN_PATH, registerAuthRoutes } from "./auth.js";

const SESSION_SECRET = "database-login-test-secret-at-least-32-characters";
const PASSWORD = "StrongPass123!";
const LOGIN_TEST_EMAIL_PATTERN =
  "^(employee|admin|disabled)\\.[0-9a-f-]{36}@example\\.test$";

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
  options: { body?: unknown; method?: string; path: string },
): Promise<TestResponse> {
  const response = await fetch(`${baseUrl}${options.path}`, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers:
      options.body === undefined
        ? undefined
        : { "content-type": "application/json" },
    method: options.method ?? "GET",
  });
  const bodyText = await response.text();
  return {
    body: bodyText === "" ? null : JSON.parse(bodyText),
    headers: response.headers,
    statusCode: response.status,
  };
}

function login(baseUrl: string, email: string, password = PASSWORD) {
  return request(baseUrl, {
    body: { email, password },
    method: "POST",
    path: LOGIN_PATH,
  });
}

async function deleteLoginTestUsers(
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
  await database
    .delete(userCapabilities)
    .where(inArray(userCapabilities.userId, [...userIds]));
  await database
    .delete(staffProfiles)
    .where(inArray(staffProfiles.userId, [...userIds]));
  await database.delete(users).where(inArray(users.id, [...userIds]));
}

async function removeInterruptedLoginTestData(
  database: AuthDatabase,
  pool: pg.Pool,
): Promise<void> {
  const result = await pool.query<{ id: string }>(
    "select id::text as id from users where email ~ $1",
    [LOGIN_TEST_EMAIL_PATTERN],
  );
  await deleteLoginTestUsers(
    database,
    pool,
    result.rows.map((row) => row.id),
  );
}

test("login endpoint creates WCIB sessions and returns scoped access summaries", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for the login smoke test");

  const pool = createDatabasePool(databaseUrl);
  const database = drizzle(pool, { schema: databaseSchema });
  const logger = new StructuredLogger({ write() {} });
  const userIds: string[] = [];
  let server: Server | null = null;

  try {
    await removeInterruptedLoginTestData(database, pool);
    const runId = randomUUID();
    const employee = await createUser(database, {
      email: `employee.${runId}@example.test`,
      password: PASSWORD,
    });
    const admin = await createUser(database, {
      email: `admin.${runId}@example.test`,
      password: PASSWORD,
    });
    const disabled = await createUser(database, {
      email: `disabled.${runId}@example.test`,
      password: PASSWORD,
    });
    userIds.push(employee.id, admin.id, disabled.id);

    await database.insert(staffProfiles).values({
      displayName: "Employee Login Test",
      role: "employee",
      userId: employee.id,
    });
    await database.insert(userCapabilities).values({
      capability: "admin",
      userId: admin.id,
    });
    await database
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, disabled.id));

    const app = createApp({
      registerRoutes(expressApp) {
        registerAuthRoutes(expressApp, { database, logger });
      },
      sessionMiddleware: createSessionMiddleware(pool, {
        logger,
        nodeEnv: "development",
        secret: SESSION_SECRET,
      }),
    });
    const runningServer = await startServer(app);
    server = runningServer.server;

    const employeeLogin = await login(
      runningServer.baseUrl,
      `  EMPLOYEE.${runId}@EXAMPLE.TEST `,
    );
    assert.equal(employeeLogin.statusCode, 200);
    assert.deepEqual(employeeLogin.body, {
      user: {
        capabilities: [],
        email: `employee.${runId}@example.test`,
        id: employee.id,
        staffRole: "employee",
      },
    });
    assert.match(employeeLogin.headers.get("set-cookie") ?? "", /wcib\.sid=/);

    const adminLogin = await login(runningServer.baseUrl, admin.email);
    assert.equal(adminLogin.statusCode, 200);
    assert.deepEqual(adminLogin.body, {
      user: {
        capabilities: ["admin"],
        email: admin.email,
        id: admin.id,
        staffRole: null,
      },
    });

    const failure = {
      error: {
        code: "invalid_credentials",
        message: "Invalid email or password",
      },
    };
    const wrongPassword = await login(
      runningServer.baseUrl,
      employee.email,
      "WrongPass123!",
    );
    const unknownUser = await login(
      runningServer.baseUrl,
      `unknown.${runId}@example.test`,
      "WrongPass123!",
    );
    const disabledUser = await login(runningServer.baseUrl, disabled.email);
    assert.equal(wrongPassword.statusCode, 401);
    assert.equal(unknownUser.statusCode, 401);
    assert.equal(disabledUser.statusCode, 401);
    assert.deepEqual(wrongPassword.body, failure);
    assert.deepEqual(unknownUser.body, failure);
    assert.deepEqual(disabledUser.body, failure);

    const storedSessions = await database
      .select({ sess: sessions.sess })
      .from(sessions);
    const testSessions = storedSessions
      .map((row) => row.sess as Record<string, unknown>)
      .filter((payload) => userIds.includes(String(payload.userId)));
    assert.equal(testSessions.length, 2);
    for (const payload of testSessions) {
      assert.deepEqual(Object.keys(payload).sort(), [
        "cookie",
        "sessionVersion",
        "userId",
      ]);
    }

    const serialized = JSON.stringify([
      employeeLogin.body,
      adminLogin.body,
      wrongPassword.body,
    ]);
    for (const forbidden of [
      "password",
      "sessionVersion",
      "organization",
      "driver",
      "customer",
      "mfa",
    ]) {
      assert.equal(serialized.includes(`"${forbidden}":`), false);
    }
  } finally {
    if (server !== null) {
      await closeServer(server);
    }
    await deleteLoginTestUsers(database, pool, userIds);
    await pool.end();
  }
});
