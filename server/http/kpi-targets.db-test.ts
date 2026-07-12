import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createDatabaseAuthorizationGuards } from "../auth/authorization.js";
import { createSessionMiddleware } from "../auth/sessions.js";
import { createUser } from "../auth/users.js";
import { createDatabasePool } from "../db/client.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  kpiTargets,
  producerRateHistory,
  staffProfiles,
  userCapabilities,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import {
  kpiTargetListResponseSchema,
  kpiTargetMutationResponseSchema,
} from "../../shared/kpi-target-api.js";
import { StructuredLogger } from "../logging/logger.js";
import {
  listKpiTargetSources,
  upsertKpiTarget,
} from "../kpi/targets.js";
import { LOGIN_PATH, registerAuthRoutes } from "./auth.js";
import {
  KPI_TARGET_PATH,
  KPI_TARGETS_PATH,
  registerKpiTargetRoutes,
} from "./kpi-targets.js";
import { auditRouteAccessDeclarations } from "./routes.js";

const PASSWORD = "StrongPass123!";
const SESSION_SECRET = "kpi-target-db-test-secret-at-least-32-characters";

interface TestResponse {
  body: unknown;
  headers: Headers;
  statusCode: number;
}

test("admin KPI targets preserve exact scopes, partial clears, and concurrency", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for KPI target endpoint test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_stone133_targets",
    async (isolatedUrl) => {
      const pool = createDatabasePool(isolatedUrl);
      const database = drizzle(pool, { schema: databaseSchema });
      const logLines: string[] = [];
      const logger = new StructuredLogger({
        write(chunk) { logLines.push(String(chunk)); },
      });
      let server: Server | null = null;
      try {
        const admin = await createUser(database, {
          email: `stone133-admin-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const producer = await createUser(database, {
          email: `stone133-producer-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        const employee = await createUser(database, {
          email: `stone133-employee-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        await database.insert(staffProfiles).values([
          {
            displayName: "STONE 133 Producer",
            role: "producer",
            userId: producer.id,
          },
          {
            displayName: "STONE 133 Employee",
            role: "employee",
            userId: employee.id,
          },
        ]);
        await database.insert(producerRateHistory).values({
          effectiveDate: "2026-01-01",
          newBrokerRate: "25.00",
          newCommissionRate: "25.00",
          producerUserId: producer.id,
          renewalBrokerRate: "25.00",
          renewalCommissionRate: "25.00",
        });

        const authorization = createDatabaseAuthorizationGuards(database, logger);
        const app = createApp({
          logger,
          registerRoutes(routes) {
            registerAuthRoutes(routes, { database, logger });
            registerKpiTargetRoutes(routes, {
              authorization,
              list: (context, query) =>
                listKpiTargetSources(database, context, query),
              logger,
              upsert: (context, scopeType, year, input) =>
                upsertKpiTarget(
                  database,
                  context,
                  scopeType,
                  year,
                  input,
                  logger,
                  new Date("2026-07-12T12:00:00.000Z"),
                ),
            });
          },
          sessionMiddleware: createSessionMiddleware(pool, {
            logger,
            nodeEnv: "development",
            secret: SESSION_SECRET,
          }),
        });
        const declarations = auditRouteAccessDeclarations(app).filter(({ path }) =>
          path.startsWith(KPI_TARGETS_PATH),
        );
        assert.deepEqual(
          declarations.map(({ access, method, path }) => [method, path, access.type]),
          [
            ["GET", KPI_TARGETS_PATH, "authorized"],
            ["PUT", KPI_TARGET_PATH, "authorized"],
          ],
        );

        const running = await startServer(app);
        server = running.server;
        const adminCookie = await login(running.baseUrl, admin.email);
        const producerCookie = await login(running.baseUrl, producer.email);
        const employeeCookie = await login(running.baseUrl, employee.email);
        await assertWrongRolesDenied(
          running.baseUrl,
          employeeCookie,
          producerCookie,
          producer.id,
        );

        const empty = await request(running.baseUrl, {
          cookie: adminCookie,
          path: `${KPI_TARGETS_PATH}?year=2026`,
        });
        assert.equal(empty.statusCode, 200);
        assert.match(empty.headers.get("cache-control") ?? "", /no-store/);
        const emptyState = kpiTargetListResponseSchema.parse(empty.body);
        assert.deepEqual(emptyState.items, []);
        assert.deepEqual(emptyState.producers, [
          {
            displayName: "STONE 133 Producer",
            isActive: true,
            producerUserId: producer.id,
          },
        ]);

        const company = await request(running.baseUrl, {
          body: {
            newPolicyCountTarget: 120,
            newRevenueTarget: "987654.32",
            producerUserId: null,
            retentionRateTarget: "82.50",
          },
          cookie: adminCookie,
          method: "PUT",
          path: targetPath("company", 2026),
        });
        assert.equal(company.statusCode, 200);
        const companyTarget = kpiTargetMutationResponseSchema.parse(company.body).target;
        assert.deepEqual(companyTarget, {
          newPolicyCountTarget: 120,
          newRevenueTarget: "987654.32",
          producerUserId: null,
          retentionRateTarget: "82.50",
          scopeType: "company",
          year: 2026,
        });
        assert.deepEqual(Object.keys(companyTarget).sort(), [
          "newPolicyCountTarget",
          "newRevenueTarget",
          "producerUserId",
          "retentionRateTarget",
          "scopeType",
          "year",
        ]);

        const concurrent = await Promise.all([
          request(running.baseUrl, {
            body: { newPolicyCountTarget: 7, producerUserId: producer.id },
            cookie: adminCookie,
            method: "PUT",
            path: targetPath("producer", 2026),
          }),
          request(running.baseUrl, {
            body: {
              newRevenueTarget: "12500.25",
              producerUserId: producer.id,
              retentionRateTarget: "75.00",
            },
            cookie: adminCookie,
            method: "PUT",
            path: targetPath("producer", 2026),
          }),
        ]);
        assert.deepEqual(concurrent.map(({ statusCode }) => statusCode), [200, 200]);
        const [producerRowCount] = await database
          .select({ count: sql<number>`count(*)::int` })
          .from(kpiTargets)
          .where(
            sql`${kpiTargets.scopeType} = 'producer' AND ${kpiTargets.producerUserId} = ${producer.id} AND ${kpiTargets.year} = 2026`,
          );
        assert.equal(producerRowCount?.count, 1);

        const producerRead = await request(running.baseUrl, {
          cookie: adminCookie,
          path: `${KPI_TARGETS_PATH}?year=2026&scopeType=producer&producerUserId=${producer.id}`,
        });
        assert.equal(producerRead.statusCode, 200);
        const producerTarget = kpiTargetListResponseSchema.parse(producerRead.body).items[0];
        assert.deepEqual(producerTarget, {
          newPolicyCountTarget: 7,
          newRevenueTarget: "12500.25",
          producerUserId: producer.id,
          retentionRateTarget: "75.00",
          scopeType: "producer",
          year: 2026,
        });

        const cleared = await request(running.baseUrl, {
          body: { newRevenueTarget: null, producerUserId: producer.id },
          cookie: adminCookie,
          method: "PUT",
          path: targetPath("producer", 2026),
        });
        assert.equal(cleared.statusCode, 200);
        assert.deepEqual(kpiTargetMutationResponseSchema.parse(cleared.body).target, {
          ...producerTarget,
          newRevenueTarget: null,
        });
        const companyAfterClear = await request(running.baseUrl, {
          cookie: adminCookie,
          path: `${KPI_TARGETS_PATH}?year=2026&scopeType=company`,
        });
        assert.deepEqual(
          kpiTargetListResponseSchema.parse(companyAfterClear.body).items,
          [companyTarget],
        );

        const badCompanyScope = await request(running.baseUrl, {
          body: { newPolicyCountTarget: 1, producerUserId: producer.id },
          cookie: adminCookie,
          method: "PUT",
          path: targetPath("company", 2027),
        });
        assert.equal(badCompanyScope.statusCode, 400);
        const employeeAsProducer = await request(running.baseUrl, {
          body: { newPolicyCountTarget: 1, producerUserId: employee.id },
          cookie: adminCookie,
          method: "PUT",
          path: targetPath("producer", 2027),
        });
        assert.equal(employeeAsProducer.statusCode, 404);
        const malformed = await request(running.baseUrl, {
          body: { newRevenueTarget: "0.1", producerUserId: null },
          cookie: adminCookie,
          method: "PUT",
          path: targetPath("company", 2027),
        });
        assert.equal(malformed.statusCode, 400);

        await database
          .update(staffProfiles)
          .set({ role: "employee" })
          .where(eq(staffProfiles.userId, producer.id));
        const historical = await request(running.baseUrl, {
          cookie: adminCookie,
          path: `${KPI_TARGETS_PATH}?year=2026`,
        });
        assert.deepEqual(
          kpiTargetListResponseSchema.parse(historical.body).producers,
          [{
            displayName: "STONE 133 Producer",
            isActive: false,
            producerUserId: producer.id,
          }],
        );

        const logs = logLines.join("\n");
        for (const secretValue of ["987654.32", "12500.25", "82.50", "75.00"]) {
          assert.equal(logs.includes(secretValue), false);
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
  producerUserId: string,
): Promise<void> {
  for (const cookie of [employeeCookie, producerCookie]) {
    for (const options of [
      { cookie, path: `${KPI_TARGETS_PATH}?year=2026` },
      {
        body: { newPolicyCountTarget: 999, producerUserId },
        cookie,
        method: "PUT",
        path: targetPath("producer", 2026),
      },
    ]) {
      const response = await request(baseUrl, options);
      assert.equal(response.statusCode, 403);
      const serialized = JSON.stringify(response.body);
      for (const forbidden of ["targets", "newRevenue", producerUserId]) {
        assert.equal(serialized.includes(forbidden), false);
      }
    }
  }
  const anonymous = await request(baseUrl, {
    path: `${KPI_TARGETS_PATH}?year=2026`,
  });
  assert.equal(anonymous.statusCode, 401);
}

function targetPath(scopeType: "company" | "producer", year: number): string {
  return KPI_TARGET_PATH
    .replace(":scopeType", scopeType)
    .replace(":year", String(year));
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

async function login(baseUrl: string, email: string): Promise<string> {
  const response = await request(baseUrl, {
    body: { email, password: PASSWORD },
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
