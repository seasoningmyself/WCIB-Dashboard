import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Express } from "express";
import type pg from "pg";
import { createApp } from "../app.js";
import { createDatabasePool } from "../db/client.js";
import * as databaseSchema from "../db/schema.js";
import {
  sessions,
  staffProfiles,
  userCapabilities,
  userMfaMethods,
  userMfaSettings,
  users,
} from "../db/schema.js";
import { LOGIN_PATH, registerAuthRoutes } from "../http/auth.js";
import { StructuredLogger } from "../logging/logger.js";
import {
  AdminMfaCapabilityRequiredError,
  createAdminMfaScaffold,
} from "./mfa-scaffold.js";
import { createSessionMiddleware } from "./sessions.js";
import { createUser, type AuthDatabase } from "./users.js";

const SESSION_SECRET =
  "database-mfa-scaffold-test-secret-at-least-32-characters";
const PASSWORD = "StrongPass123!";
const MFA_TEST_EMAIL_PATTERN =
  "^mfa-(admin|employee)\\.[0-9a-f-]{36}@example\\.test$";

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

function login(baseUrl: string, email: string) {
  return request(baseUrl, {
    body: { email, password: PASSWORD },
    method: "POST",
    path: LOGIN_PATH,
  });
}

async function deleteMfaTestUsers(
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
    .delete(userMfaMethods)
    .where(inArray(userMfaMethods.userId, [...userIds]));
  await database
    .delete(userMfaSettings)
    .where(inArray(userMfaSettings.userId, [...userIds]));
  await database
    .delete(userCapabilities)
    .where(inArray(userCapabilities.userId, [...userIds]));
  await database
    .delete(staffProfiles)
    .where(inArray(staffProfiles.userId, [...userIds]));
  await database.delete(users).where(inArray(users.id, [...userIds]));
}

async function removeInterruptedMfaTestData(
  database: AuthDatabase,
  pool: pg.Pool,
): Promise<void> {
  const result = await pool.query<{ id: string }>(
    "select id::text as id from users where email ~ $1",
    [MFA_TEST_EMAIL_PATTERN],
  );
  await deleteMfaTestUsers(
    database,
    pool,
    result.rows.map((row) => row.id),
  );
}

test("admin MFA scaffold stays inert and does not alter password login", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for the MFA scaffold test");

  const pool = createDatabasePool(databaseUrl);
  const database = drizzle(pool, { schema: databaseSchema });
  const logger = new StructuredLogger({ write() {} });
  const userIds: string[] = [];
  let server: Server | null = null;

  try {
    await removeInterruptedMfaTestData(database, pool);
    const runId = randomUUID();
    const admin = await createUser(database, {
      email: `mfa-admin.${runId}@example.test`,
      password: PASSWORD,
    });
    const employee = await createUser(database, {
      displayName: "MFA Employee Test",
      email: `mfa-employee.${runId}@example.test`,
      password: PASSWORD,
    });
    userIds.push(admin.id, employee.id);
    await database.insert(userCapabilities).values({
      capability: "admin",
      userId: admin.id,
    });
    await database.insert(staffProfiles).values({
      role: "employee",
      userId: employee.id,
    });

    const emptyScaffold = await createAdminMfaScaffold(database, admin.id);
    assert.deepEqual(emptyScaffold, {
      enforcementEnabled: false,
      methods: [],
      userId: admin.id,
    });
    await assert.rejects(
      createAdminMfaScaffold(database, employee.id),
      AdminMfaCapabilityRequiredError,
    );

    const app = createApp({
      registerRoutes(routes) {
        registerAuthRoutes(routes, { database, logger });
      },
      sessionMiddleware: createSessionMiddleware(pool, {
        logger,
        nodeEnv: "development",
        secret: SESSION_SECRET,
      }),
    });
    const runningServer = await startServer(app);
    server = runningServer.server;

    const adminWithoutMethods = await login(runningServer.baseUrl, admin.email);
    const employeeLogin = await login(runningServer.baseUrl, employee.email);
    assert.equal(adminWithoutMethods.statusCode, 200);
    assert.equal(employeeLogin.statusCode, 200);

    const populatedScaffold = await createAdminMfaScaffold(database, admin.id);
    assert.deepEqual(populatedScaffold, {
      enforcementEnabled: false,
      methods: [],
      userId: admin.id,
    });
    const adminWithMethods = await login(runningServer.baseUrl, admin.email);
    assert.equal(adminWithMethods.statusCode, 200);

    for (const response of [
      adminWithoutMethods,
      employeeLogin,
      adminWithMethods,
    ]) {
      const serialized = JSON.stringify(response.body);
      assert.equal(serialized.includes('"mfa"'), false);
      assert.equal(serialized.includes("challenge"), false);
      assert.equal(serialized.includes("recovery"), false);
      assert.equal(serialized.includes("trusted"), false);
    }

    const storedSessions = await database
      .select({ sess: sessions.sess })
      .from(sessions);
    const testSessions = storedSessions
      .map((row) => row.sess as Record<string, unknown>)
      .filter((payload) => userIds.includes(String(payload.userId)));
    assert.equal(testSessions.length, 3);
    for (const payload of testSessions) {
      assert.deepEqual(Object.keys(payload).sort(), [
        "authenticationState",
        "cookie",
        "sessionVersion",
        "userId",
      ]);
    }

    const missingMfaRoute = await request(runningServer.baseUrl, {
      body: { code: "123456" },
      method: "POST",
      path: "/api/auth/mfa/verify",
    });
    assert.equal(missingMfaRoute.statusCode, 404);

    const tables = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name like '%mfa%' order by table_name",
    );
    assert.ok(tables.rows.some((row) => row.table_name === "user_mfa_methods"));
    assert.ok(
      tables.rows.some((row) => row.table_name === "mfa_step_up_authorizations"),
    );
  } finally {
    if (server !== null) {
      await closeServer(server);
    }
    await deleteMfaTestUsers(database, pool, userIds);
    await pool.end();
  }
});
