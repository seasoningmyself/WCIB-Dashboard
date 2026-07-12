import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Express } from "express";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { createApp } from "../app.js";
import { createDatabaseAuthorizationGuards } from "../auth/authorization.js";
import { createSessionMiddleware } from "../auth/sessions.js";
import { createUser, type AuthDatabase } from "../auth/users.js";
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
import { closePaySheet } from "../pay-sheets/close.js";
import { syncMgaPaymentSheetPlacement } from "../pay-sheets/mga-placement.js";
import { listPaySheetSources } from "../pay-sheets/read.js";
import { setMgaPaymentState } from "../policies/mga-payments.js";
import { applyPolicyCorrection } from "../policies/corrections.js";
import { LOGIN_PATH, registerAuthRoutes } from "./auth.js";
import {
  PAY_SHEET_EXCEL_EXPORT_PATH,
  PAY_SHEET_PRINT_EXPORT_PATH,
  registerPaySheetExportRoutes,
} from "./pay-sheet-exports.js";

const PASSWORD = "StrongPass123!";
const SESSION_SECRET = "pay-sheet-export-db-test-secret-at-least-32-characters";
const GENERATED_AT = new Date("2026-07-12T12:00:00.000Z");

test("managed-shaped Postgres exports remain projected, frozen, scoped, and read-only", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for pay-sheet export test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_stone131_exports",
    async (isolatedUrl) => {
      const pool = createDatabasePool(isolatedUrl);
      const database = drizzle(pool, { schema: databaseSchema });
      const logger = new StructuredLogger({ write() {} });
      let server: Server | null = null;
      try {
        const admin = await createUser(database, {
          email: `pay-sheet-export-admin-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const context = {
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
          .where(inArray(users.id, [references.submittedByUserId, references.producerUserId]));
        const emailById = new Map(fixtureUsers.map((user) => [user.id, user.email]));

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
          .values(policyTestInput(references, {
            amountPaid: "1000.00",
            basePremium: "1000.00",
            brokerFee: "50.00",
            commissionAmount: "100.00",
            commissionConfirmed: true,
            commissionMode: "pct",
            commissionRate: "10.0000",
            createdAt: openedAt,
            financeBalance: "0.00",
            insuredName: "=SUM(1,1) Export Insured",
            kayleeSplit: "book",
            netDue: "850.00",
            paymentMode: "full",
            policyNumber: "+EXPORT-POLICY",
            producerUserId: references.producerUserId,
            proposalTotal: "1050.00",
            sourceDraftId: null,
            transactionType: "New",
            updatedAt: openedAt,
          }))
          .returning();
        assert.ok(policy);
        const paidAt = new Date("2026-07-05T12:00:00.000Z");
        await setMgaPaymentState(database, context, policy.id, "paid", null, logger, paidAt);
        await syncMgaPaymentSheetPlacement(database, context, policy.id, true, logger, paidAt);

        const authorization = createDatabaseAuthorizationGuards(database, logger);
        const app = createApp({
          logger,
          registerRoutes(routes) {
            registerAuthRoutes(routes, { database, logger });
            registerPaySheetExportRoutes(routes, {
              authorization,
              clock: () => GENERATED_AT,
              list: (authorizedContext, query) =>
                listPaySheetSources(database, authorizedContext, query),
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

        const beforeOpenExports = await rowCounts(database);
        const openExcel = await exportRequest(
          running.baseUrl,
          adminCookie,
          PAY_SHEET_EXCEL_EXPORT_PATH,
        );
        const openPrint = await exportRequest(
          running.baseUrl,
          adminCookie,
          PAY_SHEET_PRINT_EXPORT_PATH,
        );
        assert.equal(openExcel.status, 200);
        assert.equal(openPrint.status, 200);
        assert.equal(openExcel.headers.get("cache-control"), "no-store");
        assert.deepEqual(await rowCounts(database), beforeOpenExports);

        const openWorkbook = await loadWorkbook(openExcel.body);
        assert.equal(workbookHasValue(openWorkbook, "'=SUM(1,1) Export Insured"), true);
        assert.equal(workbookHasValue(openWorkbook, "'+EXPORT-POLICY"), true);
        assert.equal(workbookValueBeside(openWorkbook, "Sophia agency gross"), 150);
        assert.equal(workbookValueBeside(openWorkbook, "Sophia take-home"), 112.5);
        assert.notEqual(
          workbookValueBeside(openWorkbook, "Sophia agency gross"),
          workbookValueBeside(openWorkbook, "Sophia take-home"),
        );
        const printHtml = openPrint.body.toString("utf8");
        assert.match(printHtml, /=SUM\(1,1\) Export Insured/);
        assert.doesNotMatch(printHtml, /<script|onerror=/i);

        const singleProducer = await exportRequest(
          running.baseUrl,
          adminCookie,
          PAY_SHEET_EXCEL_EXPORT_PATH,
          `&ownerUserId=${references.producerUserId}`,
        );
        const singleWorkbook = await loadWorkbook(singleProducer.body);
        assert.equal(singleWorkbook.worksheets.length, 3);
        assert.equal(workbookValueBeside(singleWorkbook, "Sophia agency gross"), undefined);
        assert.equal(workbookHasValue(singleWorkbook, "50"), false);

        for (const cookie of [employeeCookie, producerCookie]) {
          for (const path of [PAY_SHEET_EXCEL_EXPORT_PATH, PAY_SHEET_PRINT_EXPORT_PATH]) {
            const denied = await exportRequest(running.baseUrl, cookie, path);
            assert.equal(denied.status, 403);
            assert.equal(denied.headers.get("content-disposition"), null);
            assert.doesNotMatch(denied.body.toString("utf8"), /Export Insured|sophiaAgencyGross|PK\u0003\u0004/);
          }
        }

        await closePaySheet(database, context, producerSheet.id, logger);
        await closePaySheet(database, context, sophiaSheet.id, logger);
        const closedBeforeEdits = await exportRequest(
          running.baseUrl,
          adminCookie,
          PAY_SHEET_EXCEL_EXPORT_PATH,
        );
        const closedWorkbookBefore = await loadWorkbook(closedBeforeEdits.body);
        const closedFactsBefore = workbookFacts(closedWorkbookBefore);

        const [livePolicyBeforeCorrection] = await database
          .select({ updatedAt: policies.updatedAt })
          .from(policies)
          .where(eq(policies.id, policy.id));
        assert.ok(livePolicyBeforeCorrection);
        await applyPolicyCorrection(
          database,
          context,
          policy.id,
          "Prove export reads frozen snapshots",
          { insuredName: "Changed Live Export Policy" },
          ["insuredName"],
          livePolicyBeforeCorrection.updatedAt,
          logger,
          new Date(livePolicyBeforeCorrection.updatedAt.getTime() + 60_000),
        );
        await database.insert(producerRateHistory).values({
          effectiveDate: "2026-07-12",
          newBrokerRate: "1.00",
          newCommissionRate: "1.00",
          producerUserId: references.producerUserId,
          renewalBrokerRate: "1.00",
          renewalCommissionRate: "1.00",
        });

        const beforeClosedExports = await rowCounts(database);
        const closedAfterEdits = await exportRequest(
          running.baseUrl,
          adminCookie,
          PAY_SHEET_EXCEL_EXPORT_PATH,
        );
        const closedPrintAfter = await exportRequest(
          running.baseUrl,
          adminCookie,
          PAY_SHEET_PRINT_EXPORT_PATH,
        );
        assert.deepEqual(await rowCounts(database), beforeClosedExports);
        const closedWorkbookAfter = await loadWorkbook(closedAfterEdits.body);
        assert.deepEqual(workbookFacts(closedWorkbookAfter), closedFactsBefore);
        assert.equal(
          workbookHasValue(closedWorkbookAfter, "Changed Live Export Policy"),
          false,
        );
        assert.doesNotMatch(
          closedPrintAfter.body.toString("utf8"),
          /Changed Live Export Policy/,
        );
      } finally {
        if (server !== null) await closeServer(server);
        await pool.end();
      }
    },
  );
});

async function rowCounts(database: AuthDatabase) {
  const result = await database.execute<{
    audits: string;
    pay_sheet_policies: string;
    pay_sheets: string;
    policies: string;
    rates: string;
  }>(sql`select
    (select count(*)::text from audit_events) as audits,
    (select count(*)::text from pay_sheet_policies) as pay_sheet_policies,
    (select count(*)::text from pay_sheets) as pay_sheets,
    (select count(*)::text from policies) as policies,
    (select count(*)::text from producer_rate_history) as rates`);
  return result.rows[0];
}

async function loadWorkbook(bytes: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  return workbook;
}

function workbookFacts(workbook: ExcelJS.Workbook): unknown {
  return workbook.worksheets.map((worksheet) => {
    const rows: unknown[][] = [];
    worksheet.eachRow((row) => {
      const values: unknown[] = [];
      row.eachCell({ includeEmpty: true }, (cell, column) => {
        values[column - 1] = cell.value;
      });
      rows.push(values);
    });
    return { name: worksheet.name, rows };
  });
}

function workbookHasValue(workbook: ExcelJS.Workbook, value: unknown): boolean {
  return workbook.worksheets.some((worksheet) => {
    let found = false;
    worksheet.eachRow((row) => row.eachCell((cell) => {
      if (cell.value === value) found = true;
    }));
    return found;
  });
}

function workbookValueBeside(workbook: ExcelJS.Workbook, label: string): unknown {
  let found: unknown;
  workbook.worksheets.forEach((worksheet) => worksheet.eachRow((row) => {
    if (row.getCell(1).value === label && found === undefined) {
      found = row.getCell(2).value;
    }
  }));
  return found;
}

async function startServer(app: Express): Promise<{ baseUrl: string; server: Server }> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  return { baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}`, server };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}

async function login(baseUrl: string, email: string): Promise<string> {
  const response = await fetch(`${baseUrl}${LOGIN_PATH}`, {
    body: JSON.stringify({ email, password: PASSWORD }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie.split(";", 1)[0] ?? "";
}

async function exportRequest(
  baseUrl: string,
  cookie: string,
  path: string,
  suffix = "",
) {
  const response = await fetch(
    `${baseUrl}${path}?periodMonth=7&periodYear=2026${suffix}`,
    { headers: { cookie } },
  );
  return {
    body: Buffer.from(await response.arrayBuffer()),
    headers: response.headers,
    status: response.status,
  };
}
