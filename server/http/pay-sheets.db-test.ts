import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Express } from "express";
import { test } from "node:test";
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
  paySheets,
  policies,
  producerRateHistory,
  userCapabilities,
  users,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { StructuredLogger } from "../logging/logger.js";
import { createPaySheetAdjustment } from "../pay-sheets/adjustments.js";
import { closePaySheet } from "../pay-sheets/close.js";
import { syncMgaPaymentSheetPlacement } from "../pay-sheets/mga-placement.js";
import {
  getPaySheetSource,
  listPaySheetSources,
} from "../pay-sheets/read.js";
import { setMgaPaymentState } from "../policies/mga-payments.js";
import { applyPolicyOverride } from "../policies/overrides.js";
import { LOGIN_PATH, registerAuthRoutes } from "./auth.js";
import {
  PAY_SHEET_DETAIL_PATH,
  PAY_SHEETS_PATH,
  registerPaySheetReadRoutes,
} from "./pay-sheets.js";

const PASSWORD = "StrongPass123!";
const SESSION_SECRET = "pay-sheet-read-db-test-secret-at-least-32-characters";

interface TestResponse {
  body: unknown;
  headers: Headers;
  statusCode: number;
}

test("pay-sheet endpoints compose open totals and immutable closed history", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for pay-sheet read test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_stone117_read",
    async (isolatedUrl) => {
      const pool = createDatabasePool(isolatedUrl);
      const database = drizzle(pool, { schema: databaseSchema });
      const logger = new StructuredLogger({ write() {} });
      let server: Server | null = null;
      try {
        const admin = await createUser(database, {
          email: `pay-sheet-read-admin-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const adminContext = {
          principal: {
            capabilities: ["admin"],
            staffRole: null,
            userActive: true,
            userId: admin.id,
          },
        } as const;
        const references = await createPolicyReferenceFixture(database);
        const fixtureUsers = await database
          .select({ email: users.email, id: users.id })
          .from(users)
          .where(
            inArray(users.id, [
              references.submittedByUserId,
              references.producerUserId,
            ]),
          );
        const emailById = new Map(
          fixtureUsers.map((user) => [user.id, user.email]),
        );

        const openedAt = new Date("2026-07-01T00:00:00.000Z");
        const [sophiaSheet, producerSheet] = await database
          .insert(paySheets)
          .values([
            {
              createdAt: openedAt,
              openedAt,
              ownerType: "sophia",
              ownerUserId: admin.id,
              periodMonth: 7,
              periodYear: 2026,
              updatedAt: openedAt,
            },
            {
              createdAt: openedAt,
              openedAt,
              ownerType: "producer",
              ownerUserId: references.producerUserId,
              periodMonth: 7,
              periodYear: 2026,
              updatedAt: openedAt,
            },
          ])
          .returning();
        assert.ok(sophiaSheet && producerSheet);

        await database.insert(producerRateHistory).values({
          effectiveDate: "2000-01-01",
          newBrokerRate: "50.00",
          newCommissionRate: "25.00",
          producerUserId: references.producerUserId,
          renewalBrokerRate: "30.00",
          renewalCommissionRate: "20.00",
        });
        const [policy] = await database
          .insert(policies)
          .values(
            policyTestInput(references, {
              amountPaid: "1000.00",
              basePremium: "1000.00",
              brokerFee: "50.00",
              commissionAmount: "100.00",
              commissionConfirmed: true,
              commissionMode: "pct",
              commissionRate: "10.0000",
              financeBalance: "0.00",
              insuredName: "Frozen Read Insured",
              kayleeSplit: "book",
              netDue: "850.00",
              paymentMode: "full",
              policyNumber: "STONE-117-POLICY",
              producerUserId: references.producerUserId,
              proposalTotal: "1050.00",
              sourceDraftId: null,
              transactionType: "New",
            }),
          )
          .returning();
        assert.ok(policy);
        const paidAt = new Date();
        await setMgaPaymentState(
          database,
          adminContext,
          policy.id,
          "paid",
          null,
          logger,
          paidAt,
        );
        await syncMgaPaymentSheetPlacement(
          database,
          adminContext,
          policy.id,
          true,
          logger,
          paidAt,
        );
        await createPaySheetAdjustment(
          database,
          adminContext,
          {
            accountBasis: "own",
            adjustmentType: "check_income",
            brokerFeeDelta: "0.00",
            commissionDelta: "0.00",
            effectiveDate: "2026-07-03",
            incomeAmount: "100.00",
            insuredOrClientLabel: "Direct check income",
            paySheetId: sophiaSheet.id,
            payoutDelta: "0.00",
            policyTypeId: null,
            producerUserId: null,
            reasonOrNote: "Read contract verification",
          },
          logger,
          new Date(paidAt.getTime() + 1),
        );

        const authorization = createDatabaseAuthorizationGuards(
          database,
          logger,
        );
        const app = createApp({
          logger,
          registerRoutes(routes) {
            registerAuthRoutes(routes, { database, logger });
            registerPaySheetReadRoutes(routes, {
              authorization,
              get: (context, paySheetId) =>
                getPaySheetSource(database, context, paySheetId),
              list: (context, query) =>
                listPaySheetSources(database, context, query),
              logger,
            });
          },
          sessionMiddleware: createSessionMiddleware(pool, {
            logger,
            nodeEnv: "development",
            secret: SESSION_SECRET,
          }),
        });
        const running = await startServer(app);
        server = running.server;
        const adminCookie = await login(running.baseUrl, admin.email);
        const employeeCookie = await login(
          running.baseUrl,
          emailById.get(references.submittedByUserId)!,
        );
        const producerCookie = await login(
          running.baseUrl,
          emailById.get(references.producerUserId)!,
        );

        const list = await request(running.baseUrl, {
          cookie: adminCookie,
          path: `${PAY_SHEETS_PATH}?status=open`,
        });
        assert.equal(list.statusCode, 200);
        assert.equal(list.headers.get("cache-control"), "no-store");
        assert.equal((list.body as any).items.length, 2);

        const sophiaOpen = await readSheet(
          running.baseUrl,
          adminCookie,
          sophiaSheet.id,
        );
        const producerOpen = await readSheet(
          running.baseUrl,
          adminCookie,
          producerSheet.id,
        );
        assert.deepEqual(sophiaOpen.totals, {
          brokerFees: "50.00",
          commissions: "100.00",
          directCheckAchIncome: "100.00",
          grandTotalIncome: "250.00",
          sophiaAgencyGross: "250.00",
          sophiaShare: "112.50",
          sophiaTakeHome: "212.50",
          trustPull: "150.00",
        });
        assert.notEqual(
          sophiaOpen.totals.sophiaAgencyGross,
          sophiaOpen.totals.sophiaTakeHome,
        );
        assert.equal(producerOpen.totals.producerPayout, "50.00");

        await closePaySheet(
          database,
          adminContext,
          sophiaSheet.id,
          logger,
        );
        await closePaySheet(
          database,
          adminContext,
          producerSheet.id,
          logger,
        );
        const sophiaClosed = await readSheet(
          running.baseUrl,
          adminCookie,
          sophiaSheet.id,
        );
        const producerClosed = await readSheet(
          running.baseUrl,
          adminCookie,
          producerSheet.id,
        );
        assert.deepEqual(sophiaClosed.totals, sophiaOpen.totals);
        assert.deepEqual(producerClosed.totals, producerOpen.totals);
        assert.equal(sophiaClosed.policies[0].source, "frozen");
        assert.equal(producerClosed.policies[0].source, "frozen");

        await applyPolicyOverride(
          database,
          adminContext,
          policy.id,
          "Prove closed pay-sheet reads ignore live policy edits",
          { commissionAmount: "200.00" },
          ["commissionAmount"],
          logger,
          new Date(),
        );
        await database.insert(producerRateHistory).values({
          effectiveDate: new Date().toISOString().slice(0, 10),
          newBrokerRate: "1.00",
          newCommissionRate: "1.00",
          producerUserId: references.producerUserId,
          renewalBrokerRate: "1.00",
          renewalCommissionRate: "1.00",
        });
        const sophiaAfterLiveChanges = await readSheet(
          running.baseUrl,
          adminCookie,
          sophiaSheet.id,
        );
        const producerAfterLiveChanges = await readSheet(
          running.baseUrl,
          adminCookie,
          producerSheet.id,
        );
        assert.deepEqual(sophiaAfterLiveChanges, sophiaClosed);
        assert.deepEqual(producerAfterLiveChanges, producerClosed);

        for (const cookie of [employeeCookie, producerCookie]) {
          for (const path of [
            PAY_SHEETS_PATH,
            PAY_SHEET_DETAIL_PATH.replace(":paySheetId", sophiaSheet.id),
          ]) {
            const denied = await request(running.baseUrl, { cookie, path });
            assert.equal(denied.statusCode, 403);
            assert.deepEqual(denied.body, {
              error: { code: "forbidden", message: "Forbidden" },
            });
            const serialized = JSON.stringify(denied.body);
            assert.equal(serialized.includes(policy.id), false);
            assert.equal(serialized.includes("sophiaAgencyGross"), false);
          }
        }
      } finally {
        if (server !== null) {
          await closeServer(server);
        }
        await pool.end();
      }
    },
  );
});

async function readSheet(
  baseUrl: string,
  cookie: string,
  paySheetId: string,
): Promise<any> {
  const response = await request(baseUrl, {
    cookie,
    path: PAY_SHEET_DETAIL_PATH.replace(":paySheetId", paySheetId),
  });
  assert.equal(response.statusCode, 200);
  return (response.body as any).sheet;
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
