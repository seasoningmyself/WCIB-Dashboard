import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Express } from "express";
import { test } from "node:test";
import { createApp } from "../app.js";
import {
  createAdminProducerRate,
  createAdminStaff,
  getAdminStaffSource,
  listAdminStaffSources,
  setAdminStaffActive,
  updateAdminProducerRate,
  updateAdminStaff,
} from "../auth/admin-staff.js";
import { createDatabaseAuthorizationGuards } from "../auth/authorization.js";
import { loadCurrentUserIdentity } from "../auth/current-user.js";
import { createSessionMiddleware } from "../auth/sessions.js";
import { createUser } from "../auth/users.js";
import { createDatabasePool } from "../db/client.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "../db/policy-test-fixture.js";
import {
  auditEvents,
  policies,
  producerRateHistory,
  staffProfiles,
  userCapabilities,
  users,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { StructuredLogger } from "../logging/logger.js";
import { LOGIN_PATH, registerAuthRoutes } from "./auth.js";
import {
  ADMIN_STAFF_DEACTIVATE_PATH,
  ADMIN_STAFF_DETAIL_PATH,
  ADMIN_STAFF_PATH,
  ADMIN_STAFF_RATE_PATH,
  ADMIN_STAFF_RATES_PATH,
  ADMIN_STAFF_REACTIVATE_PATH,
  registerAdminStaffRoutes,
} from "./admin-staff.js";
import { CURRENT_USER_PATH, registerCurrentUserRoute } from "./current-user.js";
import { auditRouteAccessDeclarations } from "./routes.js";

const PASSWORD = "StrongPass123!";
const SESSION_SECRET = "admin-staff-db-test-secret-at-least-32-characters";
const INITIAL_RATE = {
  effectiveDate: "2026-01-01",
  newBrokerRate: "15.00",
  newCommissionRate: "25.00",
  renewalBrokerRate: "10.00",
  renewalCommissionRate: "20.00",
};

interface TestResponse {
  body: unknown;
  headers: Headers;
  statusCode: number;
}

test("admin staff endpoints preserve identity history and rate integrity", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for admin staff test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_stone127_staff",
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
        const references = await createPolicyReferenceFixture(database);
        const fixtureUsers = await database
          .select({ email: users.email, id: users.id })
          .from(users)
          .where(
            inArray(users.id, [
              references.producerUserId,
              references.submittedByUserId,
            ]),
          );
        const fixtureEmailById = new Map(
          fixtureUsers.map(({ email, id }) => [id, email]),
        );
        const employeeEmail = fixtureEmailById.get(references.submittedByUserId);
        const producerEmail = fixtureEmailById.get(references.producerUserId);
        assert.ok(employeeEmail && producerEmail);

        const admin = await createUser(database, {
          email: `stone127-admin-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const authorization = createDatabaseAuthorizationGuards(database, logger);
        const app = createApp({
          logger,
          registerRoutes(routes) {
            registerAuthRoutes(routes, { database, logger });
            registerCurrentUserRoute(routes, {
              authorization,
              loadIdentity: (userId) => loadCurrentUserIdentity(database, userId),
            });
            registerAdminStaffRoutes(routes, {
              authorization,
              create: (context, input) =>
                createAdminStaff(database, context, input, logger),
              createRate: (context, userId, input) =>
                createAdminProducerRate(database, context, userId, input, logger),
              get: (context, userId) =>
                getAdminStaffSource(database, context, userId),
              list: (context) => listAdminStaffSources(database, context),
              logger,
              setActive: (context, userId, active) =>
                setAdminStaffActive(database, context, userId, active, logger),
              update: (context, userId, input) =>
                updateAdminStaff(database, context, userId, input, logger),
              updateRate: (context, userId, rateId, input) =>
                updateAdminProducerRate(
                  database,
                  context,
                  userId,
                  rateId,
                  input,
                  logger,
                ),
            });
          },
          sessionMiddleware: createSessionMiddleware(pool, {
            logger,
            nodeEnv: "development",
            secret: SESSION_SECRET,
          }),
        });
        const adminRoutes = auditRouteAccessDeclarations(app).filter(({ path }) =>
          path.startsWith(ADMIN_STAFF_PATH),
        );
        assert.equal(adminRoutes.length, 8);
        assert.equal(
          adminRoutes.every(({ access }) => access.type === "authorized"),
          true,
        );
        assert.equal(adminRoutes.some(({ method }) => method === "DELETE"), false);

        const running = await startServer(app);
        server = running.server;
        const adminCookie = await login(running.baseUrl, admin.email, PASSWORD);
        const employeeCookie = await login(running.baseUrl, employeeEmail, PASSWORD);
        const producerCookie = await login(running.baseUrl, producerEmail, PASSWORD);

        await assertWrongRolesDenied(
          running.baseUrl,
          employeeCookie,
          producerCookie,
        );

        const employeeTemporaryPassword = "EmployeePass123!";
        const employeeCreate = await request(running.baseUrl, {
          body: {
            displayName: "New Employee",
            email: "new.employee@example.test",
            role: "employee",
            temporaryPassword: employeeTemporaryPassword,
          },
          cookie: adminCookie,
          method: "POST",
          path: ADMIN_STAFF_PATH,
        });
        assert.equal(employeeCreate.statusCode, 201);
        const employee = (employeeCreate.body as any).staff;
        assert.deepEqual(Object.keys(employee), [
          "createdAt",
          "displayName",
          "email",
          "isActive",
          "rateState",
          "rates",
          "role",
          "userId",
        ]);
        assert.equal(employee.rateState, "not_applicable");
        assert.equal(JSON.stringify(employeeCreate.body).includes("password"), false);
        assert.equal(JSON.stringify(employeeCreate.body).includes("sessionVersion"), false);
        const newEmployeeCookie = await login(
          running.baseUrl,
          "new.employee@example.test",
          employeeTemporaryPassword,
        );
        assert.equal(
          (await request(running.baseUrl, {
            cookie: newEmployeeCookie,
            path: CURRENT_USER_PATH,
          })).statusCode,
          200,
        );

        const producerTemporaryPassword = "ProducerPass123!";
        const producerCreate = await request(running.baseUrl, {
          body: {
            displayName: "New Producer",
            email: "new.producer@example.test",
            initialRate: INITIAL_RATE,
            role: "producer",
            temporaryPassword: producerTemporaryPassword,
          },
          cookie: adminCookie,
          method: "POST",
          path: ADMIN_STAFF_PATH,
        });
        assert.equal(producerCreate.statusCode, 201);
        const producer = (producerCreate.body as any).staff;
        assert.equal(producer.rateState, "configured");
        assert.equal(producer.rates.length, 1);
        const firstRateId = producer.rates[0].id as string;

        for (const body of [
          {
            displayName: "Sophia",
            email: `reserved-${randomUUID()}@example.test`,
            role: "employee",
            temporaryPassword: PASSWORD,
          },
          {
            displayName: "new producer",
            email: `duplicate-name-${randomUUID()}@example.test`,
            role: "employee",
            temporaryPassword: PASSWORD,
          },
          {
            displayName: "Unique Name",
            email: "new.employee@example.test",
            role: "employee",
            temporaryPassword: PASSWORD,
          },
        ]) {
          const conflict = await request(running.baseUrl, {
            body,
            cookie: adminCookie,
            method: "POST",
            path: ADMIN_STAFF_PATH,
          });
          assert.equal(conflict.statusCode, 409);
          assertNoStaffPayload(conflict.body);
        }

        const missingRate = await request(running.baseUrl, {
          body: { role: "producer" },
          cookie: adminCookie,
          method: "PATCH",
          path: ADMIN_STAFF_DETAIL_PATH.replace(":userId", employee.userId),
        });
        assert.equal(missingRate.statusCode, 409);
        const promoted = await request(running.baseUrl, {
          body: { initialRate: INITIAL_RATE, role: "producer" },
          cookie: adminCookie,
          method: "PATCH",
          path: ADMIN_STAFF_DETAIL_PATH.replace(":userId", employee.userId),
        });
        assert.equal(promoted.statusCode, 200);
        assert.equal((promoted.body as any).staff.rateState, "configured");
        assert.equal(
          (await request(running.baseUrl, {
            cookie: newEmployeeCookie,
            path: CURRENT_USER_PATH,
          })).statusCode,
          401,
        );
        const demoted = await request(running.baseUrl, {
          body: { role: "employee" },
          cookie: adminCookie,
          method: "PATCH",
          path: ADMIN_STAFF_DETAIL_PATH.replace(":userId", employee.userId),
        });
        assert.equal(demoted.statusCode, 200);
        assert.equal((demoted.body as any).staff.rateState, "dormant");
        assert.equal((demoted.body as any).staff.rates.length, 1);
        const rateWhileEmployee = await request(running.baseUrl, {
          body: { ...INITIAL_RATE, effectiveDate: "2026-02-01" },
          cookie: adminCookie,
          method: "POST",
          path: ADMIN_STAFF_RATES_PATH.replace(":userId", employee.userId),
        });
        assert.equal(rateWhileEmployee.statusCode, 409);
        const promotedWithDormantHistory = await request(running.baseUrl, {
          body: { role: "producer" },
          cookie: adminCookie,
          method: "PATCH",
          path: ADMIN_STAFF_DETAIL_PATH.replace(":userId", employee.userId),
        });
        assert.equal(promotedWithDormantHistory.statusCode, 200);
        assert.equal((promotedWithDormantHistory.body as any).staff.rates.length, 1);

        const secondRateCreate = await request(running.baseUrl, {
          body: { ...INITIAL_RATE, effectiveDate: "2026-06-01" },
          cookie: adminCookie,
          method: "POST",
          path: ADMIN_STAFF_RATES_PATH.replace(":userId", producer.userId),
        });
        assert.equal(secondRateCreate.statusCode, 201);
        const secondRate = (secondRateCreate.body as any).staff.rates.find(
          (rate: any) => rate.effectiveDate === "2026-06-01",
        );
        assert.ok(secondRate);
        const correctedRate = { ...INITIAL_RATE, effectiveDate: "2026-07-01" };
        const correction = await request(running.baseUrl, {
          body: correctedRate,
          cookie: adminCookie,
          method: "PATCH",
          path: ADMIN_STAFF_RATE_PATH
            .replace(":userId", producer.userId)
            .replace(":rateId", secondRate.id),
        });
        assert.equal(correction.statusCode, 200);
        assert.equal(
          (correction.body as any).staff.rates.some(
            (rate: any) => rate.effectiveDate === "2026-07-01",
          ),
          true,
        );

        const lockedAt = new Date("2026-07-12T12:00:00.000Z");
        await database.execute(sql`
          select lock_producer_rate_history_for_close(
            ${firstRateId}::uuid,
            ${lockedAt.toISOString()}::timestamp with time zone
          )
        `);
        const lockedEdit = await request(running.baseUrl, {
          body: { ...INITIAL_RATE, newCommissionRate: "26.00" },
          cookie: adminCookie,
          method: "PATCH",
          path: ADMIN_STAFF_RATE_PATH
            .replace(":userId", producer.userId)
            .replace(":rateId", firstRateId),
        });
        assert.equal(lockedEdit.statusCode, 409);
        const [stillLocked] = await database
          .select({
            lockedAt: producerRateHistory.lockedAt,
            newCommissionRate: producerRateHistory.newCommissionRate,
          })
          .from(producerRateHistory)
          .where(eq(producerRateHistory.id, firstRateId));
        assert.equal(stillLocked?.newCommissionRate, "25.00");
        assert.equal(stillLocked?.lockedAt?.toISOString(), lockedAt.toISOString());

        const [historicalPolicy] = await database
          .insert(policies)
          .values(
            policyTestInput(references, {
              accountAssignment: "book",
              insuredName: "Preserved Staff History",
              kayleeSplit: "book",
              policyNumber: `STONE-127-${randomUUID()}`,
              producerUserId: producer.userId,
              sourceDraftId: null,
            }),
          )
          .returning({ id: policies.id });
        assert.ok(historicalPolicy);
        const producerSession = await login(
          running.baseUrl,
          "new.producer@example.test",
          producerTemporaryPassword,
        );
        assert.equal(
          (await request(running.baseUrl, {
            cookie: producerSession,
            path: CURRENT_USER_PATH,
          })).statusCode,
          200,
        );
        const beforeDeactivation = await accountState(database, producer.userId);
        const deactivated = await request(running.baseUrl, {
          body: {},
          cookie: adminCookie,
          method: "POST",
          path: ADMIN_STAFF_DEACTIVATE_PATH.replace(":userId", producer.userId),
        });
        assert.equal(deactivated.statusCode, 200);
        assert.equal((deactivated.body as any).staff.isActive, false);
        assert.equal(
          (await request(running.baseUrl, {
            cookie: producerSession,
            path: CURRENT_USER_PATH,
          })).statusCode,
          401,
        );
        const afterDeactivation = await accountState(database, producer.userId);
        assert.equal(afterDeactivation?.isActive, false);
        assert.equal(
          afterDeactivation?.sessionVersion,
          (beforeDeactivation?.sessionVersion ?? -1) + 1,
        );
        assert.equal(await rowCount(database, policies, historicalPolicy.id), 1);
        assert.equal(
          (
            await database
              .select({ id: producerRateHistory.id })
              .from(producerRateHistory)
              .where(eq(producerRateHistory.producerUserId, producer.userId))
          ).length,
          2,
        );
        const reactivated = await request(running.baseUrl, {
          body: {},
          cookie: adminCookie,
          method: "POST",
          path: ADMIN_STAFF_REACTIVATE_PATH.replace(":userId", producer.userId),
        });
        assert.equal(reactivated.statusCode, 200);
        assert.equal((reactivated.body as any).staff.isActive, true);
        assert.equal(
          (await request(running.baseUrl, {
            cookie: producerSession,
            path: CURRENT_USER_PATH,
          })).statusCode,
          401,
        );

        await forceAuditFailure(pool, "staff_account_changed");
        try {
          const failedStaffAudit = await request(running.baseUrl, {
            body: { displayName: "Must Roll Back" },
            cookie: adminCookie,
            method: "PATCH",
            path: ADMIN_STAFF_DETAIL_PATH.replace(":userId", producer.userId),
          });
          assert.equal(failedStaffAudit.statusCode, 500);
        } finally {
          await removeAuditFailure(pool);
        }
        const [nameAfterFailure] = await database
          .select({ displayName: staffProfiles.displayName })
          .from(staffProfiles)
          .where(eq(staffProfiles.userId, producer.userId));
        assert.equal(nameAfterFailure?.displayName, "New Producer");

        await forceAuditFailure(pool, "producer_rate_changed");
        try {
          const failedRateAudit = await request(running.baseUrl, {
            body: { ...correctedRate, newBrokerRate: "16.00" },
            cookie: adminCookie,
            method: "PATCH",
            path: ADMIN_STAFF_RATE_PATH
              .replace(":userId", producer.userId)
              .replace(":rateId", secondRate.id),
          });
          assert.equal(failedRateAudit.statusCode, 500);
        } finally {
          await removeAuditFailure(pool);
        }
        const [rateAfterFailure] = await database
          .select({ newBrokerRate: producerRateHistory.newBrokerRate })
          .from(producerRateHistory)
          .where(eq(producerRateHistory.id, secondRate.id));
        assert.equal(rateAfterFailure?.newBrokerRate, "15.00");

        const roster = await request(running.baseUrl, {
          cookie: adminCookie,
          path: ADMIN_STAFF_PATH,
        });
        assert.equal(roster.statusCode, 200);
        assert.equal(roster.headers.get("cache-control"), "no-store");
        const serializedRoster = JSON.stringify(roster.body);
        for (const forbidden of [
          "passwordHash",
          "temporaryPassword",
          "sessionVersion",
          "sessionId",
          "resetToken",
        ]) {
          assert.equal(serializedRoster.includes(forbidden), false, forbidden);
        }

        const relevantAudits = await database
          .select({
            action: auditEvents.action,
            afterSummary: auditEvents.afterSummary,
            beforeSummary: auditEvents.beforeSummary,
          })
          .from(auditEvents)
          .where(
            inArray(auditEvents.action, [
              "staff_account_changed",
              "producer_rate_changed",
            ]),
          );
        assert.ok(relevantAudits.some(({ action }) => action === "staff_account_changed"));
        assert.ok(relevantAudits.some(({ action }) => action === "producer_rate_changed"));
        const serializedAudits = JSON.stringify(relevantAudits);
        for (const secret of [
          employeeTemporaryPassword,
          producerTemporaryPassword,
          "new.employee@example.test",
          "new.producer@example.test",
          "New Employee",
          "New Producer",
          "25.00",
          "15.00",
        ]) {
          assert.equal(serializedAudits.includes(secret), false, secret);
        }
        const serializedLogs = logLines.join("");
        for (const secret of [
          employeeTemporaryPassword,
          producerTemporaryPassword,
          "new.employee@example.test",
          "new.producer@example.test",
          "New Employee",
          "New Producer",
          "25.00",
          "15.00",
        ]) {
          assert.equal(serializedLogs.includes(secret), false, secret);
        }
      } finally {
        if (server !== null) await closeServer(server);
        await pool.end();
      }
    },
  );
});

async function assertWrongRolesDenied(
  baseUrl: string,
  employeeCookie: string,
  producerCookie: string,
): Promise<void> {
  const userId = randomUUID();
  const rateId = randomUUID();
  const requests = [
    { path: ADMIN_STAFF_PATH },
    { path: ADMIN_STAFF_DETAIL_PATH.replace(":userId", userId) },
    { body: {}, method: "POST", path: ADMIN_STAFF_PATH },
    {
      body: {},
      method: "PATCH",
      path: ADMIN_STAFF_DETAIL_PATH.replace(":userId", userId),
    },
    {
      body: {},
      method: "POST",
      path: ADMIN_STAFF_DEACTIVATE_PATH.replace(":userId", userId),
    },
    {
      body: {},
      method: "POST",
      path: ADMIN_STAFF_REACTIVATE_PATH.replace(":userId", userId),
    },
    {
      body: {},
      method: "POST",
      path: ADMIN_STAFF_RATES_PATH.replace(":userId", userId),
    },
    {
      body: {},
      method: "PATCH",
      path: ADMIN_STAFF_RATE_PATH
        .replace(":userId", userId)
        .replace(":rateId", rateId),
    },
  ];
  for (const identity of [
    { cookie: undefined, statusCode: 401 },
    { cookie: employeeCookie, statusCode: 403 },
    { cookie: producerCookie, statusCode: 403 },
  ]) {
    for (const candidate of requests) {
      const response = await request(baseUrl, {
        ...candidate,
        cookie: identity.cookie,
      });
      assert.equal(response.statusCode, identity.statusCode);
      assertNoStaffPayload(response.body);
    }
  }
}

function assertNoStaffPayload(body: unknown): void {
  const serialized = JSON.stringify(body);
  for (const field of [
    "displayName",
    "email",
    "rates",
    "newCommissionRate",
    "temporaryPassword",
  ]) {
    assert.equal(serialized.includes(`\"${field}\"`), false, field);
  }
}

async function accountState(
  database: ReturnType<typeof drizzle<typeof databaseSchema>>,
  userId: string,
) {
  const [row] = await database
    .select({ isActive: users.isActive, sessionVersion: users.sessionVersion })
    .from(users)
    .where(eq(users.id, userId));
  return row;
}

async function rowCount(
  database: ReturnType<typeof drizzle<typeof databaseSchema>>,
  table: typeof policies,
  id: string,
): Promise<number> {
  const [row] = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(table)
    .where(eq(table.id, id));
  return row?.count ?? 0;
}

async function forceAuditFailure(
  pool: ReturnType<typeof createDatabasePool>,
  action: "producer_rate_changed" | "staff_account_changed",
): Promise<void> {
  await pool.query(`
    CREATE FUNCTION fail_admin_staff_audit_for_test()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.action = '${action}'::audit_action THEN
        RAISE EXCEPTION 'forced admin staff audit failure'
          USING ERRCODE = '55001';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await pool.query(`
    CREATE TRIGGER fail_admin_staff_audit_for_test_trigger
    BEFORE INSERT ON audit_events
    FOR EACH ROW
    EXECUTE FUNCTION fail_admin_staff_audit_for_test()
  `);
}

async function removeAuditFailure(
  pool: ReturnType<typeof createDatabasePool>,
): Promise<void> {
  await pool.query(
    "DROP TRIGGER fail_admin_staff_audit_for_test_trigger ON audit_events",
  );
  await pool.query("DROP FUNCTION fail_admin_staff_audit_for_test()");
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

async function login(
  baseUrl: string,
  email: string,
  password: string,
): Promise<string> {
  const response = await request(baseUrl, {
    body: { email, password },
    method: "POST",
    path: LOGIN_PATH,
  });
  assert.equal(response.statusCode, 200);
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie.split(";", 1)[0] ?? "";
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
