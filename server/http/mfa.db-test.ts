import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Express } from "express";
import { generateSync } from "otplib";
import { createApp } from "../app.js";
import {
  AUTHENTICATED_ACCESS,
  createDatabaseAuthorizationGuards,
} from "../auth/authorization.js";
import { createSessionMiddleware } from "../auth/sessions.js";
import { createUser } from "../auth/users.js";
import { readMfaConfig } from "../config/mfa.js";
import { createDatabasePool } from "../db/client.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  auditEvents,
  loginThrottleBuckets,
  staffProfiles,
  userCapabilities,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { StructuredLogger } from "../logging/logger.js";
import { LOGIN_PATH, registerAuthRoutes } from "./auth.js";
import {
  MFA_LOGIN_TOTP_PATH,
  MFA_LOGIN_PASSKEY_START_PATH,
  MFA_RECOVERY_ACK_PATH,
  MFA_SETTINGS_PATH,
  MFA_STEP_UP_PASSKEY_START_PATH,
  MFA_TOTP_CONFIRM_PATH,
  MFA_TOTP_START_PATH,
  registerMfaRoutes,
} from "./mfa.js";

const PASSWORD = "Route throttle harbor 72!";
const SESSION_SECRET = "mfa-route-test-secret-at-least-32-characters";

interface TestResponse {
  body: unknown;
  headers: Headers;
  statusCode: number;
}

test("MFA routes enforce the shared account throttle and restricted challenge state", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for the MFA route test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_mfa_routes",
    async (isolatedUrl) => {
      const pool = createDatabasePool(isolatedUrl);
      const database = drizzle(pool, { schema: databaseSchema });
      const logger = new StructuredLogger({ write() {} });
      const authorization = createDatabaseAuthorizationGuards(database, logger, {
        adminMfaEnforcementEnabled: true,
      });
      const config = readMfaConfig(
        { WCIB_ADMIN_MFA_REQUIRED: "true" },
        "development",
        SESSION_SECRET,
      );
      let protectedHandlerCalls = 0;
      let server: Server | null = null;

      try {
        const user = await createUser(database, {
          displayName: "MFA Route QA",
          email: `mfa-route-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        await database.insert(staffProfiles).values({
          role: "employee",
          userId: user.id,
        });
        const requiredAdmin = await createUser(database, {
          displayName: "Required MFA Admin",
          email: `mfa-required-admin-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: requiredAdmin.id,
        });
        const forcedUser = await createUser(database, {
          displayName: "Forced Password User",
          email: `mfa-forced-password-${randomUUID()}@example.test`,
          password: PASSWORD,
          passwordChangeRequired: true,
        });
        await database.insert(staffProfiles).values({
          role: "employee",
          userId: forcedUser.id,
        });
        const noFactorUser = await createUser(database, {
          displayName: "No Factor User",
          email: `mfa-no-factor-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        await database.insert(staffProfiles).values({
          role: "employee",
          userId: noFactorUser.id,
        });

        const app = createApp({
          logger,
          registerRoutes(routes) {
            registerAuthRoutes(routes, {
              adminMfaEnforcementEnabled: true,
              database,
              logger,
              loginThrottleSecret: SESSION_SECRET,
            });
            registerMfaRoutes(routes, {
              authorization,
              config,
              database,
              logger,
              loginThrottleSecret: SESSION_SECRET,
            });
            routes.get(
              "/api/test/mfa-protected",
              { authorization: authorization.require(AUTHENTICATED_ACCESS) },
              (_req, res) => {
                protectedHandlerCalls += 1;
                res.json({ status: "ok" });
              },
            );
          },
          sessionMiddleware: createSessionMiddleware(pool, {
            logger,
            nodeEnv: "development",
            secret: SESSION_SECRET,
          }),
        });
        const running = await startServer(app);
        server = running.server;

        const forcedLogin = await request(running.baseUrl, {
          body: { email: forcedUser.email, password: PASSWORD },
          method: "POST",
          path: LOGIN_PATH,
        });
        assert.equal(forcedLogin.statusCode, 200);
        assert.equal(
          (forcedLogin.body as any).authenticationState,
          "authenticated",
        );
        const forcedMfaSettings = await request(running.baseUrl, {
          cookie: readCookie(forcedLogin),
          path: MFA_SETTINGS_PATH,
        });
        assert.equal(forcedMfaSettings.statusCode, 403);
        assert.equal(
          (forcedMfaSettings.body as any).error.code,
          "password_change_required",
        );

        const requiredAdminLogin = await request(running.baseUrl, {
          body: { email: requiredAdmin.email, password: PASSWORD },
          method: "POST",
          path: LOGIN_PATH,
        });
        assert.equal(requiredAdminLogin.statusCode, 200);
        assert.equal(
          (requiredAdminLogin.body as any).authenticationState,
          "mfa_required",
        );
        const requiredAdminCookie = readCookie(requiredAdminLogin);
        const requiredAdminProtected = await request(running.baseUrl, {
          cookie: requiredAdminCookie,
          path: "/api/test/mfa-protected",
        });
        assert.equal(requiredAdminProtected.statusCode, 403);
        assert.equal(
          (requiredAdminProtected.body as any).error.code,
          "mfa_enrollment_required",
        );
        const requiredAdminEnrollment = await request(running.baseUrl, {
          body: { label: "Required admin authenticator" },
          cookie: requiredAdminCookie,
          method: "POST",
          path: MFA_TOTP_START_PATH,
        });
        assert.equal(requiredAdminEnrollment.statusCode, 200);

        const initialLogin = await request(running.baseUrl, {
          body: { email: user.email, password: PASSWORD },
          method: "POST",
          path: LOGIN_PATH,
        });
        assert.equal(initialLogin.statusCode, 200);
        let cookie = readCookie(initialLogin);

        const unnamedTotp = await request(running.baseUrl, {
          body: {},
          cookie,
          method: "POST",
          path: MFA_TOTP_START_PATH,
        });
        assert.equal(unnamedTotp.statusCode, 400);
        assert.equal(
          (unnamedTotp.body as any).error.code,
          "validation_error",
        );

        const start = await request(running.baseUrl, {
          body: { label: "Route test authenticator" },
          cookie,
          method: "POST",
          path: MFA_TOTP_START_PATH,
        });
        assert.equal(start.statusCode, 200);
        const enrollment = start.body as {
          methodId: string;
          secret: string;
        };
        assert.match(enrollment.secret, /^[A-Z2-7]+$/);

        const enrollmentCode = totpCode(enrollment.secret);
        const confirmed = await request(running.baseUrl, {
          body: { code: enrollmentCode, methodId: enrollment.methodId },
          cookie,
          method: "POST",
          path: MFA_TOTP_CONFIRM_PATH,
        });
        assert.equal(confirmed.statusCode, 200);
        assert.equal((confirmed.body as any).codes.length, 10);
        cookie = readCookie(confirmed);

        const acknowledged = await request(running.baseUrl, {
          body: { saved: true },
          cookie,
          method: "POST",
          path: MFA_RECOVERY_ACK_PATH,
        });
        assert.equal(acknowledged.statusCode, 204);

        const enrolledLogin = await request(running.baseUrl, {
          body: { email: user.email, password: PASSWORD },
          method: "POST",
          path: LOGIN_PATH,
        });
        assert.equal(enrolledLogin.statusCode, 200);
        assert.equal(
          (enrolledLogin.body as any).authenticationState,
          "mfa_required",
        );
        const challengeCookie = readCookie(enrolledLogin);

        const protectedResponse = await request(running.baseUrl, {
          cookie: challengeCookie,
          path: "/api/test/mfa-protected",
        });
        assert.equal(protectedResponse.statusCode, 403);
        assert.equal(
          (protectedResponse.body as any).error.code,
          "mfa_challenge_required",
        );
        assert.equal(protectedHandlerCalls, 0);

        const unavailablePasskey = await request(running.baseUrl, {
          cookie: challengeCookie,
          method: "POST",
          path: MFA_LOGIN_PASSKEY_START_PATH,
        });
        assert.equal(unavailablePasskey.statusCode, 401);
        assert.equal(
          (unavailablePasskey.body as any).error.code,
          "invalid_mfa_challenge",
        );

        const invalidCode = enrollmentCode === "000000" ? "000001" : "000000";
        for (let attempt = 2; attempt <= 5; attempt += 1) {
          const failed = await request(running.baseUrl, {
            body: { code: invalidCode },
            cookie: challengeCookie,
            method: "POST",
            path: MFA_LOGIN_TOTP_PATH,
          });
          if (attempt < 5) {
            assert.equal(failed.statusCode, 401);
            assert.equal(
              (failed.body as any).error.code,
              "invalid_mfa_challenge",
            );
          } else {
            assert.equal(failed.statusCode, 429);
            assert.equal((failed.body as any).error.code, "too_many_attempts");
            assert.equal(failed.headers.get("retry-after"), "60");
          }
        }

        const blockedValidAttempt = await request(running.baseUrl, {
          body: { code: totpCode(enrollment.secret) },
          cookie: challengeCookie,
          method: "POST",
          path: MFA_LOGIN_TOTP_PATH,
        });
        assert.equal(blockedValidAttempt.statusCode, 429);
        assert.equal(blockedValidAttempt.headers.get("retry-after"), "60");

        const [accountBucket] = await database
          .select({
            blockedUntil: loginThrottleBuckets.blockedUntil,
            failureCount: loginThrottleBuckets.failureCount,
          })
          .from(loginThrottleBuckets)
          .where(eq(loginThrottleBuckets.kind, "account"));
        assert.equal(accountBucket?.failureCount, 5);
        assert.ok(accountBucket?.blockedUntil instanceof Date);

        const failures = await database
          .select({
            afterSummary: auditEvents.afterSummary,
            beforeSummary: auditEvents.beforeSummary,
          })
          .from(auditEvents)
          .where(eq(auditEvents.action, "user_mfa_challenge_failed"));
        assert.equal(failures.length, 5);
        const auditText = JSON.stringify(failures);
        assert.equal(auditText.includes(invalidCode), false);
        assert.equal(auditText.includes(enrollment.secret), false);

        const noFactorLogin = await request(running.baseUrl, {
          body: { email: noFactorUser.email, password: PASSWORD },
          method: "POST",
          path: LOGIN_PATH,
        });
        assert.equal(noFactorLogin.statusCode, 200);
        const unavailableStepUp = await request(running.baseUrl, {
          body: {
            currentPassword: PASSWORD,
            descriptor: {
              action: "admin_staff_update",
              mutation: { email: "unavailable@example.test" },
              targetUserId: noFactorUser.id,
            },
          },
          cookie: readCookie(noFactorLogin),
          method: "POST",
          path: MFA_STEP_UP_PASSKEY_START_PATH,
        });
        assert.equal(unavailableStepUp.statusCode, 403);
        assert.equal(
          (unavailableStepUp.body as any).error.code,
          "invalid_mfa_challenge",
        );
        const stepUpFailures = await database
          .select({ afterSummary: auditEvents.afterSummary })
          .from(auditEvents)
          .where(eq(auditEvents.action, "user_mfa_step_up_failed"));
        assert.equal(stepUpFailures.length, 1);
        assert.equal(JSON.stringify(stepUpFailures).includes(PASSWORD), false);
      } finally {
        if (server !== null) await closeServer(server);
        await pool.end();
      }
    },
  );
});

function totpCode(secret: string): string {
  return generateSync({
    digits: 6,
    epoch: Math.floor(Date.now() / 1_000),
    period: 30,
    secret,
  });
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
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

async function request(
  baseUrl: string,
  options: { body?: unknown; cookie?: string; method?: string; path: string },
): Promise<TestResponse> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.cookie !== undefined) headers.cookie = options.cookie;
  const response = await fetch(`${baseUrl}${options.path}`, {
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers,
    method: options.method ?? "GET",
  });
  const bodyText = await response.text();
  return {
    body: bodyText.length === 0 ? null : JSON.parse(bodyText),
    headers: response.headers,
    statusCode: response.status,
  };
}

function readCookie(response: TestResponse): string {
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie !== null);
  return setCookie.split(";", 1)[0] ?? "";
}
