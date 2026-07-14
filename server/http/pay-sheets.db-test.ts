import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray } from "drizzle-orm";
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
  auditEvents,
  userCapabilities,
  users,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { StructuredLogger } from "../logging/logger.js";
import {
  createPaySheetAdjustment,
  deletePaySheetAdjustment,
  updatePaySheetAdjustment,
} from "../pay-sheets/adjustments.js";
import { getPaySheetAdjustmentTarget } from "../pay-sheets/adjustment-target.js";
import { closePaySheetWithCascade } from "../pay-sheets/close.js";
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
import {
  PAY_SHEET_CLOSE_PATH,
  registerPaySheetCloseRoute,
} from "./pay-sheet-close.js";
import {
  PAY_SHEET_ADJUSTMENT_CREATE_PATH,
  PAY_SHEET_ADJUSTMENT_PATH,
  registerPaySheetAdjustmentRoutes,
} from "./pay-sheet-adjustments.js";

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
            registerPaySheetCloseRoute(routes, {
              authorization,
              close: (context, paySheetId, cascadeProducerSheets) =>
                closePaySheetWithCascade(
                  database,
                  context,
                  paySheetId,
                  cascadeProducerSheets,
                  logger,
                ),
              get: (context, paySheetId) =>
                getPaySheetSource(database, context, paySheetId),
              logger,
            });
            registerPaySheetAdjustmentRoutes(routes, {
              authorization,
              create: (context, input) =>
                createPaySheetAdjustment(database, context, input, logger),
              delete: (context, adjustmentId) =>
                deletePaySheetAdjustment(
                  database,
                  context,
                  adjustmentId,
                  logger,
                ),
              getSheet: (context, paySheetId) =>
                getPaySheetSource(database, context, paySheetId),
              getTarget: (context, adjustmentId) =>
                getPaySheetAdjustmentTarget(database, context, adjustmentId),
              logger,
              update: (context, adjustmentId, input) =>
                updatePaySheetAdjustment(
                  database,
                  context,
                  adjustmentId,
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

        const directIncome = await createAdjustment(
          running.baseUrl,
          adminCookie,
          sophiaSheet.id,
          directIncomeInput("100.00"),
        );
        const directIncomeId = directIncome.mutation.adjustmentId;
        assert.equal(directIncome.mutation.action, "created");
        assert.equal(directIncome.sheet.totals.sophiaAgencyGross, "250.00");

        const temporaryCorrection = await createAdjustment(
          running.baseUrl,
          adminCookie,
          sophiaSheet.id,
          correctionInput({ brokerFeeDelta: "-10.00" }),
        );
        const temporaryCorrectionId =
          temporaryCorrection.mutation.adjustmentId;
        const updatedCorrection = await changeAdjustment(
          running.baseUrl,
          adminCookie,
          "PUT",
          temporaryCorrectionId,
          correctionInput({ brokerFeeDelta: "-20.00" }),
        );
        assert.equal(updatedCorrection.mutation.action, "updated");
        const deletedCorrection = await changeAdjustment(
          running.baseUrl,
          adminCookie,
          "DELETE",
          temporaryCorrectionId,
          {},
        );
        assert.equal(deletedCorrection.mutation.action, "deleted");
        assert.equal(
          deletedCorrection.sheet.adjustments.some(
            (adjustment: any) => adjustment.id === temporaryCorrectionId,
          ),
          false,
        );

        const producerAdjustment = await createAdjustment(
          running.baseUrl,
          adminCookie,
          producerSheet.id,
          correctionInput({
            accountBasis: "book",
            brokerFeeDelta: "0.00",
            payoutDelta: "-5.00",
            producerUserId: references.producerUserId,
          }),
        );
        assert.equal(
          producerAdjustment.sheet.totals.producerPayout,
          "45.00",
        );

        const producerDirectIncome = await request(running.baseUrl, {
          body: directIncomeInput("25.00"),
          cookie: adminCookie,
          method: "POST",
          path: PAY_SHEET_ADJUSTMENT_CREATE_PATH.replace(
            ":paySheetId",
            producerSheet.id,
          ),
        });
        assert.equal(producerDirectIncome.statusCode, 400);
        const sophiaPayout = await request(running.baseUrl, {
          body: correctionInput({
            brokerFeeDelta: "0.00",
            payoutDelta: "-5.00",
          }),
          cookie: adminCookie,
          method: "POST",
          path: PAY_SHEET_ADJUSTMENT_CREATE_PATH.replace(
            ":paySheetId",
            sophiaSheet.id,
          ),
        });
        assert.equal(sophiaPayout.statusCode, 400);
        const crossSheetUpdate = await request(running.baseUrl, {
          body: {
            ...directIncomeInput("100.00"),
            paySheetId: producerSheet.id,
          },
          cookie: adminCookie,
          method: "PUT",
          path: PAY_SHEET_ADJUSTMENT_PATH.replace(
            ":adjustmentId",
            directIncomeId,
          ),
        });
        assert.equal(crossSheetUpdate.statusCode, 400);

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
        assert.equal(producerOpen.totals.producerPayout, "45.00");

        const sophiaClose = await closeSheet(
          running.baseUrl,
          adminCookie,
          sophiaSheet.id,
        );
        assert.equal(sophiaClose.close.closed, true);
        assert.equal(sophiaClose.closedSheet.id, sophiaSheet.id);
        assert.equal(sophiaClose.nextSheet.periodMonth, 8);
        assert.deepEqual(sophiaClose.closedSheet.totals, sophiaOpen.totals);

        const sophiaRepeat = await closeSheet(
          running.baseUrl,
          adminCookie,
          sophiaSheet.id,
        );
        assert.equal(sophiaRepeat.close.closed, false);
        assert.equal(
          sophiaRepeat.close.nextSheetId,
          sophiaClose.close.nextSheetId,
        );

        const concurrentProducerCloses = await Promise.all([
          closeSheet(running.baseUrl, adminCookie, producerSheet.id),
          closeSheet(running.baseUrl, adminCookie, producerSheet.id),
        ]);
        assert.deepEqual(
          concurrentProducerCloses
            .map((response) => response.close.closed)
            .sort(),
          [false, true],
        );
        assert.equal(
          concurrentProducerCloses[0].close.nextSheetId,
          concurrentProducerCloses[1].close.nextSheetId,
        );
        assert.deepEqual(
          concurrentProducerCloses[0].closedSheet.totals,
          producerOpen.totals,
        );

        const closeAudits = await database
          .select({ entityId: auditEvents.entityId })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.action, "pay_sheet_closed"),
              inArray(auditEvents.entityId, [sophiaSheet.id, producerSheet.id]),
            ),
          );
        assert.deepEqual(
          closeAudits.map(({ entityId }) => entityId).sort(),
          [producerSheet.id, sophiaSheet.id].sort(),
        );
        const nextOpenSheets = await database
          .select({ id: paySheets.id })
          .from(paySheets)
          .where(eq(paySheets.status, "open"));
        assert.equal(nextOpenSheets.length, 2);

        for (const mutation of [
          {
            body: directIncomeInput("25.00"),
            method: "POST",
            path: PAY_SHEET_ADJUSTMENT_CREATE_PATH.replace(
              ":paySheetId",
              sophiaSheet.id,
            ),
          },
          {
            body: directIncomeInput("100.00"),
            method: "PUT",
            path: PAY_SHEET_ADJUSTMENT_PATH.replace(
              ":adjustmentId",
              directIncomeId,
            ),
          },
          {
            body: {},
            method: "DELETE",
            path: PAY_SHEET_ADJUSTMENT_PATH.replace(
              ":adjustmentId",
              directIncomeId,
            ),
          },
        ]) {
          const rejected = await request(running.baseUrl, {
            ...mutation,
            cookie: adminCookie,
          });
          assert.equal(rejected.statusCode, 409);
        }

        const nextPeriodAdjustment = await createAdjustment(
          running.baseUrl,
          adminCookie,
          sophiaClose.close.nextSheetId,
          { ...directIncomeInput("25.00"), adjustmentType: "ach_income" },
        );
        assert.equal(nextPeriodAdjustment.mutation.action, "created");
        assert.equal(
          nextPeriodAdjustment.sheet.totals.sophiaAgencyGross,
          "25.00",
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
          const deniedClose = await request(running.baseUrl, {
            body: {},
            cookie,
            method: "POST",
            path: PAY_SHEET_CLOSE_PATH.replace(
              ":paySheetId",
              sophiaSheet.id,
            ),
          });
          assert.equal(deniedClose.statusCode, 403);
          assert.deepEqual(deniedClose.body, {
            error: { code: "forbidden", message: "Forbidden" },
          });
          const deniedAdjustment = await request(running.baseUrl, {
            body: directIncomeInput("10.00"),
            cookie,
            method: "POST",
            path: PAY_SHEET_ADJUSTMENT_CREATE_PATH.replace(
              ":paySheetId",
              sophiaClose.close.nextSheetId,
            ),
          });
          assert.equal(deniedAdjustment.statusCode, 403);
          assert.deepEqual(deniedAdjustment.body, {
            error: { code: "forbidden", message: "Forbidden" },
          });
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

async function closeSheet(
  baseUrl: string,
  cookie: string,
  paySheetId: string,
): Promise<any> {
  const response = await request(baseUrl, {
    body: { cascadeProducerSheets: false },
    cookie,
    method: "POST",
    path: PAY_SHEET_CLOSE_PATH.replace(":paySheetId", paySheetId),
  });
  assert.equal(response.statusCode, 200);
  return response.body as any;
}

async function createAdjustment(
  baseUrl: string,
  cookie: string,
  paySheetId: string,
  body: unknown,
): Promise<any> {
  const response = await request(baseUrl, {
    body,
    cookie,
    method: "POST",
    path: PAY_SHEET_ADJUSTMENT_CREATE_PATH.replace(
      ":paySheetId",
      paySheetId,
    ),
  });
  assert.equal(response.statusCode, 200);
  return response.body as any;
}

async function changeAdjustment(
  baseUrl: string,
  cookie: string,
  method: "DELETE" | "PUT",
  adjustmentId: string,
  body: unknown,
): Promise<any> {
  const response = await request(baseUrl, {
    body,
    cookie,
    method,
    path: PAY_SHEET_ADJUSTMENT_PATH.replace(
      ":adjustmentId",
      adjustmentId,
    ),
  });
  assert.equal(response.statusCode, 200);
  return response.body as any;
}

function directIncomeInput(incomeAmount: string) {
  return {
    accountBasis: "own",
    adjustmentType: "check_income",
    brokerFeeDelta: "0.00",
    commissionDelta: "0.00",
    effectiveDate: "2026-07-03",
    incomeAmount,
    insuredOrClientLabel: "Direct income client",
    payoutDelta: "0.00",
    policyTypeId: null,
    producerUserId: null,
    reasonOrNote: "Adjustment endpoint verification",
  };
}

function correctionInput(overrides: Record<string, unknown> = {}) {
  return {
    accountBasis: "own",
    adjustmentType: "chargeback",
    brokerFeeDelta: "-10.00",
    commissionDelta: "0.00",
    effectiveDate: "2026-07-04",
    incomeAmount: "0.00",
    insuredOrClientLabel: "Correction client",
    payoutDelta: "0.00",
    policyTypeId: null,
    producerUserId: null,
    reasonOrNote: "Adjustment endpoint correction",
    ...overrides,
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
