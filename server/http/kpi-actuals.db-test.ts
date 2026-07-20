import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Express } from "express";
import { createApp } from "../app.js";
import { createDatabaseAuthorizationGuards } from "../auth/authorization.js";
import { createSessionMiddleware } from "../auth/sessions.js";
import { createUser } from "../auth/users.js";
import { createDatabasePool } from "../db/client.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "../db/policy-test-fixture.js";
import {
  officeLocations,
  paySheets,
  policies,
  producerRateHistory,
  staffProfiles,
  userCapabilities,
  users,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { kpiActualResponseSchema } from "../../shared/kpi-actuals.js";
import { loadKpiActualSource } from "../kpi/actuals.js";
import { StructuredLogger } from "../logging/logger.js";
import { createPaySheetAdjustment } from "../pay-sheets/adjustments.js";
import { closePaySheet } from "../pay-sheets/close.js";
import { syncMgaPaymentSheetPlacement } from "../pay-sheets/mga-placement.js";
import { applyPolicyCorrection } from "../policies/corrections.js";
import { setMgaPaymentState } from "../policies/mga-payments.js";
import { LOGIN_PATH, registerAuthRoutes } from "./auth.js";
import {
  KPI_ACTUALS_PATH,
  registerKpiActualRoute,
} from "./kpi-actuals.js";
import { auditRouteAccessDeclarations } from "./routes.js";

const PASSWORD = "StrongPass123!";
const SESSION_SECRET = "kpi-actual-db-test-secret-at-least-32-characters";

interface TestResponse {
  body: unknown;
  headers: Headers;
  statusCode: number;
}

test("KPI endpoint reads only closed snapshots across company and producer scopes", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for KPI actual endpoint test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_stone134_actuals",
    async (isolatedUrl) => {
      const pool = createDatabasePool(isolatedUrl);
      const database = drizzle(pool, { schema: databaseSchema });
      const logLines: string[] = [];
      const logger = new StructuredLogger({
        write(chunk) { logLines.push(String(chunk)); },
      });
      let server: Server | null = null;
      try {
        const references = await createPolicyReferenceFixture(database);
        const admin = await createUser(database, {
          email: `stone134-admin-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const producerTwo = await createUser(database, {
          displayName: "STONE 134 Producer Two",
          email: `stone134-producer-two-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        await database.insert(staffProfiles).values({
          role: "producer",
          userId: producerTwo.id,
        });
        await database.insert(producerRateHistory).values([
          rate(references.producerUserId, "2026-01-01", "25.00"),
          rate(producerTwo.id, "2026-01-01", "25.00"),
        ]);
        const identityRows = await database
          .select({ email: users.email, id: users.id })
          .from(users)
          .where(inArray(users.id, [
            references.submittedByUserId,
            references.producerUserId,
          ]));
        const emailById = new Map(identityRows.map(({ email, id }) => [id, email]));

        const createdAt = new Date("2026-07-01T12:00:00.000Z");
        const [newPolicy, wonBackPolicy] = await database
          .insert(policies)
          .values([
            policyTestInput(references, {
              amountPaid: "1000.00",
              basePremium: "1000.00",
              brokerFee: "50.00",
              commissionAmount: "100.00",
              commissionConfirmed: true,
              commissionMode: "pct",
              commissionRate: "10.0000",
              kayleeSplit: "book",
              netDue: "850.00",
              policyNumber: "STONE-134-NEW",
              producerUserId: references.producerUserId,
              proposalTotal: "1050.00",
              sourceDraftId: null,
              transactionType: "New",
            }),
            policyTestInput(references, {
              amountPaid: "500.00",
              basePremium: "500.00",
              brokerFee: "20.00",
              commissionAmount: "60.00",
              commissionConfirmed: true,
              commissionMode: "pct",
              commissionRate: "12.0000",
              kayleeSplit: "house",
              netDue: "420.00",
              policyNumber: "STONE-134-WON-BACK",
              producerUserId: producerTwo.id,
              proposalTotal: "520.00",
              sourceDraftId: null,
              transactionType: "Won Back",
            }),
          ])
          .returning();
        assert.ok(newPolicy && wonBackPolicy);

        const [sophiaSheet, producerOneSheet, producerTwoSheet] = await database
          .insert(paySheets)
          .values([
            openSheet(admin.id, "sophia", createdAt),
            openSheet(references.producerUserId, "producer", createdAt),
            openSheet(producerTwo.id, "producer", createdAt),
          ])
          .returning();
        assert.ok(sophiaSheet && producerOneSheet && producerTwoSheet);

        const context = adminContext(admin.id);
        for (const policy of [newPolicy, wonBackPolicy]) {
          const paidAt = new Date("2026-07-15T12:00:00.000Z");
          await setMgaPaymentState(
            database,
            context,
            policy.id,
            "paid",
            null,
            logger,
            paidAt,
          );
          await syncMgaPaymentSheetPlacement(
            database,
            context,
            policy.id,
            true,
            logger,
            paidAt,
          );
        }
        await closePaySheet(database, context, sophiaSheet.id, logger);
        await closePaySheet(database, context, producerOneSheet.id, logger);
        await closePaySheet(database, context, producerTwoSheet.id, logger);

        const authorization = createDatabaseAuthorizationGuards(database, logger);
        const app = createApp({
          logger,
          registerRoutes(routes) {
            registerAuthRoutes(routes, { database, logger });
            registerKpiActualRoute(routes, {
              authorization,
              list: (authorizedContext, query) =>
                loadKpiActualSource(database, authorizedContext, query),
              logger,
            });
          },
          sessionMiddleware: createSessionMiddleware(pool, {
            logger,
            nodeEnv: "development",
            secret: SESSION_SECRET,
          }),
        });
        assert.deepEqual(
          auditRouteAccessDeclarations(app)
            .filter(({ path }) => path === KPI_ACTUALS_PATH)
            .map(({ access, method, path }) => [method, path, access.type]),
          [["GET", KPI_ACTUALS_PATH, "authorized"]],
        );

        const running = await startServer(app);
        server = running.server;
        const adminCookie = await login(running.baseUrl, admin.email);
        const producerCookie = await login(
          running.baseUrl,
          emailById.get(references.producerUserId)!,
        );
        const employeeCookie = await login(
          running.baseUrl,
          emailById.get(references.submittedByUserId)!,
        );
        await assertWrongRolesDenied(
          running.baseUrl,
          employeeCookie,
          producerCookie,
        );

        const companyAtClose = await request(running.baseUrl, {
          cookie: adminCookie,
          path: actualPath("company", 2026, "Q3"),
        });
        assert.equal(companyAtClose.statusCode, 200);
        assert.match(companyAtClose.headers.get("cache-control") ?? "", /no-store/);
        const company = kpiActualResponseSchema.parse(companyAtClose.body);
        assert.deepEqual(company.totals, {
          agencyRevenue: "230.00",
          existingPolicyCount: 1,
          newPolicyCount: 1,
          newRevenue: "150.00",
          policyCount: 2,
          producerBookPayout: "37.50",
          producerFirstYearHousePayout: "20.00",
          producerPayout: "57.50",
          retentionRate: "50.00",
          wonBackCount: 1,
          wonBackRevenue: "80.00",
        });
        assert.deepEqual(company.monthly.map(({ month }) => month), [7, 8, 9]);
        assert.equal(company.monthly[0]?.agencyRevenue, "230.00");
        assert.equal(company.monthly[0]?.producerPayout, "57.50");
        assert.equal(company.producerPayouts.length, 2);

        const producerAtClose = await request(running.baseUrl, {
          cookie: adminCookie,
          path: actualPath(
            "producer",
            2026,
            "Q3",
            references.producerUserId,
          ),
        });
        assert.equal(producerAtClose.statusCode, 200);
        const producer = kpiActualResponseSchema.parse(producerAtClose.body);
        assert.equal(producer.totals.policyCount, 1);
        assert.equal(producer.totals.agencyRevenue, "150.00");
        assert.equal(producer.totals.producerPayout, "37.50");
        assert.deepEqual(
          producer.producerPayouts.map(({ producerUserId }) => producerUserId),
          [references.producerUserId],
        );
        assert.equal(JSON.stringify(producer).includes(producerTwo.id), false);

        const repeatedProducer = await request(running.baseUrl, {
          cookie: adminCookie,
          path: `${actualPath("producer", 2026, "Q3", references.producerUserId)}&producerUserId=${producerTwo.id}`,
        });
        assert.equal(repeatedProducer.statusCode, 400);
        const labelTrick = await request(running.baseUrl, {
          cookie: adminCookie,
          path: `${actualPath("producer", 2026, "Q3", references.producerUserId)}&displayName=STONE%20134%20Producer%20Two`,
        });
        assert.equal(labelTrick.statusCode, 400);

        const empty = await request(running.baseUrl, {
          cookie: adminCookie,
          path: actualPath("company", 2026, "Q4"),
        });
        const emptyActuals = kpiActualResponseSchema.parse(empty.body);
        assert.equal(emptyActuals.empty, true);
        assert.equal(emptyActuals.totals.retentionRate, null);
        assert.deepEqual(emptyActuals.monthly.map(({ month }) => month), [10, 11, 12]);

        const [liveBefore] = await database
          .select({ updatedAt: policies.updatedAt })
          .from(policies)
          .where(eq(policies.id, newPolicy.id));
        assert.ok(liveBefore);
        await applyPolicyCorrection(
          database,
          context,
          newPolicy.id,
          "Prove KPI actuals remain frozen",
          { insuredName: "Changed live policy", transactionType: "Won Back" },
          ["insuredName", "transactionType"],
          liveBefore.updatedAt,
          logger,
          new Date("2026-08-02T12:00:00.000Z"),
        );
        await database.insert(producerRateHistory).values(
          rate(references.producerUserId, "2026-08-01", "99.00"),
        );
        await database
          .update(officeLocations)
          .set({ name: "Changed current office", updatedAt: new Date() })
          .where(eq(officeLocations.id, references.officeLocationId));
        const [openSophiaSheet] = await database
          .select()
          .from(paySheets)
          .where(
            and(
              eq(paySheets.ownerType, "sophia"),
              eq(paySheets.status, "open"),
            ),
          );
        assert.ok(openSophiaSheet);
        await createPaySheetAdjustment(database, context, {
          accountBasis: "own",
          adjustmentType: "direct_deposit",
          brokerFeeDelta: "0.00",
          commissionDelta: "0.00",
          effectiveDate: "2026-08-01",
          incomeAmount: "9999.99",
          insuredOrClientLabel: "Open sheet only",
          paySheetId: openSophiaSheet.id,
          payoutDelta: "0.00",
          policyTypeId: null,
          producerUserId: null,
          reasonOrNote: null,
        }, logger, new Date("2026-08-02T13:00:00.000Z"));

        const companyAfterLiveChanges = kpiActualResponseSchema.parse(
          (await request(running.baseUrl, {
            cookie: adminCookie,
            path: actualPath("company", 2026, "Q3"),
          })).body,
        );
        const producerAfterLiveChanges = kpiActualResponseSchema.parse(
          (await request(running.baseUrl, {
            cookie: adminCookie,
            path: actualPath(
              "producer",
              2026,
              "Q3",
              references.producerUserId,
            ),
          })).body,
        );
        assert.deepEqual(
          numericFingerprint(companyAfterLiveChanges),
          numericFingerprint(company),
        );
        assert.deepEqual(
          numericFingerprint(producerAfterLiveChanges),
          numericFingerprint(producer),
        );
        assert.equal(
          companyAfterLiveChanges.offices.some(
            ({ displayName }) => displayName === "Changed current office",
          ),
          true,
        );

        const logs = logLines.join("\n");
        for (const financialValue of ["230.00", "57.50", "9999.99"]) {
          assert.equal(logs.includes(financialValue), false);
        }
      } finally {
        if (server !== null) await closeServer(server);
        await pool.end();
      }
    },
  );
});

function numericFingerprint(actuals: ReturnType<typeof kpiActualResponseSchema.parse>) {
  return {
    empty: actuals.empty,
    monthly: actuals.monthly,
    offices: actuals.offices.map(({ displayName: _displayName, ...office }) => office),
    period: actuals.period,
    producerPayouts: actuals.producerPayouts.map(
      ({ displayName: _displayName, ...payout }) => payout,
    ),
    scope: {
      producerUserId: actuals.scope.producerUserId,
      scopeType: actuals.scope.scopeType,
    },
    totals: actuals.totals,
    transactionTypes: actuals.transactionTypes,
    year: actuals.year,
  };
}

async function assertWrongRolesDenied(
  baseUrl: string,
  employeeCookie: string,
  producerCookie: string,
): Promise<void> {
  for (const cookie of [employeeCookie, producerCookie]) {
    const denied = await request(baseUrl, {
      cookie,
      path: actualPath("company", 2026, "Q3"),
    });
    assert.equal(denied.statusCode, 403);
    const serialized = JSON.stringify(denied.body);
    for (const forbidden of ["agencyRevenue", "producerPayout", "monthly"]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  }
  const anonymous = await request(baseUrl, {
    path: actualPath("company", 2026, "Q3"),
  });
  assert.equal(anonymous.statusCode, 401);
}

function actualPath(
  scopeType: "company" | "producer",
  year: number,
  period: "full" | "Q1" | "Q2" | "Q3" | "Q4",
  producerUserId?: string,
): string {
  const query = new URLSearchParams({ period, scopeType, year: String(year) });
  if (producerUserId !== undefined) query.set("producerUserId", producerUserId);
  return `${KPI_ACTUALS_PATH}?${query}`;
}

function rate(producerUserId: string, effectiveDate: string, value: string) {
  return {
    effectiveDate,
    newBrokerRate: value,
    newCommissionRate: value,
    producerUserId,
    renewalBrokerRate: value,
    renewalCommissionRate: value,
  };
}

function openSheet(
  ownerUserId: string,
  ownerType: "producer" | "sophia",
  createdAt: Date,
) {
  return {
    createdAt,
    openedAt: createdAt,
    ownerType,
    ownerUserId,
    periodMonth: 7,
    periodYear: 2026,
    updatedAt: createdAt,
  };
}

function adminContext(userId: string) {
  return {
    principal: {
      capabilities: ["admin"] as const,
      staffRole: null,
      userActive: true,
      userId,
    },
  };
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
