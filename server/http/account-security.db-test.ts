import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Express } from "express";
import { test } from "node:test";
import { createApp } from "../app.js";
import {
  AUTHENTICATED_ACCESS,
  createDatabaseAuthorizationGuards,
} from "../auth/authorization.js";
import { loadCurrentUserIdentity } from "../auth/current-user.js";
import {
  changeOwnPassword,
  replaceRequiredPassword,
} from "../auth/password-changes.js";
import { loadOwnSettings, updateOwnProfile } from "../auth/settings.js";
import {
  createSessionMiddleware,
  establishAuthenticatedSession,
} from "../auth/sessions.js";
import { createUser } from "../auth/users.js";
import { createDatabasePool } from "../db/client.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  auditEvents,
  officeLocations,
  sessions,
  staffProfiles,
  userCapabilities,
  users,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { StructuredLogger } from "../logging/logger.js";
import { LOGIN_PATH, registerAuthRoutes } from "./auth.js";
import { CURRENT_USER_PATH, registerCurrentUserRoute } from "./current-user.js";
import {
  REQUIRED_PASSWORD_CHANGE_PATH,
  registerRequiredPasswordChangeRoute,
} from "./required-password-change.js";
import {
  OWN_SETTINGS_PASSWORD_PATH,
  OWN_SETTINGS_PATH,
  OWN_SETTINGS_PROFILE_PATH,
  registerSettingsRoutes,
} from "./settings.js";

const TEMPORARY_PASSWORD = "Initial temporary 2026!";
const FIRST_PASSWORD = "Blue harbor lantern 73!";
const SECOND_PASSWORD = "Copper archive window 84!";
const SESSION_SECRET = "account-security-test-secret-at-least-32-characters";

interface TestResponse {
  body: unknown;
  headers: Headers;
  statusCode: number;
}

test("first-login replacement and own settings enforce session and ownership boundaries", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for account security tests");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_account_security",
    async (isolatedUrl) => {
      const pool = createDatabasePool(isolatedUrl);
      const database = drizzle(pool, { schema: databaseSchema });
      const logLines: string[] = [];
      const logger = new StructuredLogger({
        write(chunk) {
          logLines.push(String(chunk));
        },
      });
      let server: Server | null = null;

      try {
        const suffix = randomUUID();
        const [office] = await database
          .insert(officeLocations)
          .values({ name: `Account Security Office ${suffix}` })
          .returning({ id: officeLocations.id, name: officeLocations.name });
        assert.ok(office);
        const account = await createUser(database, {
          displayName: `Forced Change User ${suffix}`,
          email: `forced-change-${suffix}@example.test`,
          password: TEMPORARY_PASSWORD,
          passwordChangeRequired: true,
        });
        const other = await createUser(database, {
          displayName: `Other Settings User ${suffix}`,
          email: `other-settings-${suffix}@example.test`,
          password: FIRST_PASSWORD,
        });
        const capabilityAdmin = await createUser(database, {
          displayName: `Capability Admin ${suffix}`,
          email: `capability-admin-${suffix}@example.test`,
          password: FIRST_PASSWORD,
        });
        await database.insert(staffProfiles).values([
          {
            officeLocationId: office.id,
            role: "employee",
            userId: account.id,
          },
          { role: "employee", userId: other.id },
        ]);
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: capabilityAdmin.id,
        });

        const authorization = createDatabaseAuthorizationGuards(database, logger);
        let protectedHandlerCalls = 0;
        const app = createApp({
          logger,
          registerRoutes(routes) {
            registerAuthRoutes(routes, { database, logger });
            registerCurrentUserRoute(routes, {
              authorization,
              loadIdentity: (userId) => loadCurrentUserIdentity(database, userId),
            });
            registerRequiredPasswordChangeRoute(routes, {
              authorization,
              change: (context, input) =>
                replaceRequiredPassword(database, context, input, logger),
              establishSession: establishAuthenticatedSession,
              logger,
            });
            registerSettingsRoutes(routes, {
              authorization,
              changePassword: (context, input) =>
                changeOwnPassword(database, context, input, logger),
              establishSession: establishAuthenticatedSession,
              load: (context) => loadOwnSettings(database, context),
              logger,
              updateProfile: (context, input) =>
                updateOwnProfile(database, context, input, logger),
            });
            routes.get(
              "/api/test/protected",
              {
                authorization: authorization.require(AUTHENTICATED_ACCESS),
              },
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

        const firstLogin = await login(
          running.baseUrl,
          account.email,
          TEMPORARY_PASSWORD,
        );
        const secondLogin = await login(
          running.baseUrl,
          account.email,
          TEMPORARY_PASSWORD,
        );
        assert.equal(firstLogin.statusCode, 200);
        assert.equal(secondLogin.statusCode, 200);
        const firstCookie = readCookie(firstLogin);
        const secondCookie = readCookie(secondLogin);

        const currentUser = await request(running.baseUrl, {
          cookie: firstCookie,
          path: CURRENT_USER_PATH,
        });
        assert.equal(currentUser.statusCode, 200);
        assert.equal((currentUser.body as any).user.passwordChangeRequired, true);

        const directProtected = await request(running.baseUrl, {
          cookie: firstCookie,
          path: "/api/test/protected",
        });
        const forcedSettings = await request(running.baseUrl, {
          cookie: firstCookie,
          path: OWN_SETTINGS_PATH,
        });
        for (const denied of [directProtected, forcedSettings]) {
          assert.equal(denied.statusCode, 403);
          assert.equal((denied.body as any).error.code, "password_change_required");
        }
        assert.equal(protectedHandlerCalls, 0);

        const blockedPassword = await request(running.baseUrl, {
          body: {
            confirmation: "password1234",
            newPassword: "password1234",
          },
          cookie: firstCookie,
          method: "POST",
          path: REQUIRED_PASSWORD_CHANGE_PATH,
        });
        assert.equal(blockedPassword.statusCode, 400);
        assert.equal((blockedPassword.body as any).error.code, "validation_error");

        const reusedTemporaryPassword = await request(running.baseUrl, {
          body: {
            confirmation: TEMPORARY_PASSWORD,
            newPassword: TEMPORARY_PASSWORD,
          },
          cookie: firstCookie,
          method: "POST",
          path: REQUIRED_PASSWORD_CHANGE_PATH,
        });
        assert.equal(reusedTemporaryPassword.statusCode, 409);
        assert.equal((reusedTemporaryPassword.body as any).error.code, "password_reuse");

        const changed = await request(running.baseUrl, {
          body: { confirmation: FIRST_PASSWORD, newPassword: FIRST_PASSWORD },
          cookie: firstCookie,
          method: "POST",
          path: REQUIRED_PASSWORD_CHANGE_PATH,
        });
        assert.equal(changed.statusCode, 204);
        const changedCookie = readCookie(changed);

        for (const oldCookie of [firstCookie, secondCookie]) {
          const invalidated = await request(running.baseUrl, {
            cookie: oldCookie,
            path: CURRENT_USER_PATH,
          });
          assert.equal(invalidated.statusCode, 401);
        }
        assert.equal(
          (await login(running.baseUrl, account.email, TEMPORARY_PASSWORD)).statusCode,
          401,
        );
        assert.equal(
          (await request(running.baseUrl, {
            cookie: changedCookie,
            path: "/api/test/protected",
          })).statusCode,
          200,
        );
        assert.equal(protectedHandlerCalls, 1);

        const settings = await request(running.baseUrl, {
          cookie: changedCookie,
          path: OWN_SETTINGS_PATH,
        });
        assert.equal(settings.statusCode, 200);
        assert.deepEqual((settings.body as any).settings.officeLocation, {
          id: office.id,
          isActive: true,
          name: office.name,
        });
        assert.equal((settings.body as any).settings.email, account.email);
        assert.equal(JSON.stringify(settings.body).includes(other.email), false);

        const adminLogin = await login(
          running.baseUrl,
          capabilityAdmin.email,
          FIRST_PASSWORD,
        );
        assert.equal(adminLogin.statusCode, 200);
        const adminSettings = await request(running.baseUrl, {
          cookie: readCookie(adminLogin),
          path: OWN_SETTINGS_PATH,
        });
        assert.equal(adminSettings.statusCode, 200);
        assert.equal((adminSettings.body as any).settings.officeLocation, null);

        const attemptedOtherRead = await request(running.baseUrl, {
          cookie: changedCookie,
          path: `${OWN_SETTINGS_PATH}/${other.id}`,
        });
        assert.equal(attemptedOtherRead.statusCode, 404);
        const injectedIdentityFields = await request(running.baseUrl, {
          body: {
            capabilities: ["admin"],
            displayName: "Must Not Apply",
            email: other.email,
            officeLocationId: null,
            role: "admin",
            userId: other.id,
          },
          cookie: changedCookie,
          method: "PATCH",
          path: OWN_SETTINGS_PROFILE_PATH,
        });
        assert.equal(injectedIdentityFields.statusCode, 400);

        const nextDisplayName = `Own Updated Name ${suffix}`;
        const profileUpdate = await request(running.baseUrl, {
          body: { displayName: nextDisplayName },
          cookie: changedCookie,
          method: "PATCH",
          path: OWN_SETTINGS_PROFILE_PATH,
        });
        assert.equal(profileUpdate.statusCode, 200);
        assert.equal((profileUpdate.body as any).settings.displayName, nextDisplayName);
        const [otherAfterAttack] = await database
          .select({ displayName: users.displayName })
          .from(users)
          .where(eq(users.id, other.id));
        assert.equal(otherAfterAttack?.displayName, `Other Settings User ${suffix}`);

        const parallelLogin = await login(
          running.baseUrl,
          account.email,
          FIRST_PASSWORD,
        );
        assert.equal(parallelLogin.statusCode, 200);
        const parallelCookie = readCookie(parallelLogin);
        const invalidCurrent = await request(running.baseUrl, {
          body: {
            confirmation: SECOND_PASSWORD,
            currentPassword: "Not the current password",
            newPassword: SECOND_PASSWORD,
          },
          cookie: changedCookie,
          method: "POST",
          path: OWN_SETTINGS_PASSWORD_PATH,
        });
        assert.equal(invalidCurrent.statusCode, 400);
        assert.equal(
          (invalidCurrent.body as any).error.code,
          "invalid_current_password",
        );
        const reusedCurrent = await request(running.baseUrl, {
          body: {
            confirmation: FIRST_PASSWORD,
            currentPassword: FIRST_PASSWORD,
            newPassword: FIRST_PASSWORD,
          },
          cookie: changedCookie,
          method: "POST",
          path: OWN_SETTINGS_PASSWORD_PATH,
        });
        assert.equal(reusedCurrent.statusCode, 409);
        assert.equal((reusedCurrent.body as any).error.code, "password_reuse");

        const selfChanged = await request(running.baseUrl, {
          body: {
            confirmation: SECOND_PASSWORD,
            currentPassword: FIRST_PASSWORD,
            newPassword: SECOND_PASSWORD,
          },
          cookie: changedCookie,
          method: "POST",
          path: OWN_SETTINGS_PASSWORD_PATH,
        });
        assert.equal(selfChanged.statusCode, 204);
        const newestCookie = readCookie(selfChanged);
        for (const staleCookie of [changedCookie, parallelCookie]) {
          assert.equal(
            (await request(running.baseUrl, {
              cookie: staleCookie,
              path: CURRENT_USER_PATH,
            })).statusCode,
            401,
          );
        }
        assert.equal(
          (await request(running.baseUrl, {
            cookie: newestCookie,
            path: CURRENT_USER_PATH,
          })).statusCode,
          200,
        );
        assert.equal(
          (await login(running.baseUrl, account.email, FIRST_PASSWORD)).statusCode,
          401,
        );
        assert.equal(
          (await login(running.baseUrl, account.email, SECOND_PASSWORD)).statusCode,
          200,
        );

        const [storedAccount] = await database
          .select({
            passwordChangeRequiredAt: users.passwordChangeRequiredAt,
            passwordHash: users.passwordHash,
            sessionVersion: users.sessionVersion,
          })
          .from(users)
          .where(eq(users.id, account.id));
        assert.equal(storedAccount?.passwordChangeRequiredAt, null);
        assert.match(storedAccount?.passwordHash ?? "", /^\$argon2id\$/);
        assert.equal(storedAccount?.sessionVersion, 2);

        const securityAudits = await database
          .select({
            action: auditEvents.action,
            actorUserId: auditEvents.actorUserId,
            afterSummary: auditEvents.afterSummary,
            entityId: auditEvents.entityId,
          })
          .from(auditEvents)
          .where(
            inArray(auditEvents.action, [
              "user_password_changed",
              "user_profile_changed",
            ]),
          );
        assert.deepEqual(
          securityAudits.map(({ action }) => action).sort(),
          [
            "user_password_changed",
            "user_password_changed",
            "user_profile_changed",
          ].sort(),
        );
        assert.equal(
          securityAudits.every(
            ({ actorUserId, entityId }) =>
              actorUserId === account.id && entityId === account.id,
          ),
          true,
        );
        const serializedEvidence = JSON.stringify({
          audits: securityAudits,
          logs: logLines,
        });
        for (const secret of [
          TEMPORARY_PASSWORD,
          FIRST_PASSWORD,
          SECOND_PASSWORD,
        ]) {
          assert.equal(serializedEvidence.includes(secret), false, secret);
        }

        const activeSessionPayloads = (
          await database.select({ sess: sessions.sess }).from(sessions)
        )
          .map(({ sess }) => sess as Record<string, unknown>)
          .filter(({ userId }) => userId === account.id);
        assert.equal(
          activeSessionPayloads.every(
            ({ sessionVersion }) => sessionVersion === storedAccount?.sessionVersion,
          ),
          true,
        );
      } finally {
        if (server !== null) await closeServer(server);
        await pool.end();
      }
    },
  );
});

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
    server.close((error) => (error === undefined ? resolve() : reject(error)));
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
  const text = await response.text();
  return {
    body: text === "" ? null : JSON.parse(text),
    headers: response.headers,
    statusCode: response.status,
  };
}

function login(baseUrl: string, email: string, password: string) {
  return request(baseUrl, {
    body: { email, password },
    method: "POST",
    path: LOGIN_PATH,
  });
}

function readCookie(response: TestResponse): string {
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  return setCookie.split(";", 1)[0] ?? "";
}
