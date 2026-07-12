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
  createDatabaseAuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import { createSessionMiddleware } from "../auth/sessions.js";
import { createUser } from "../auth/users.js";
import { listMyCommissionSources } from "../commissions/read.js";
import { setProducerCommissionReceipt } from "../commissions/receipts.js";
import { createDatabasePool } from "../db/client.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
  type PolicyReferenceFixture,
} from "../db/policy-test-fixture.js";
import {
  auditEvents,
  paySheetPolicies,
  paySheets,
  policies,
  producerRateHistory,
  staffProfiles,
  userCapabilities,
  users,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { StructuredLogger } from "../logging/logger.js";
import { closePaySheet } from "../pay-sheets/close.js";
import { syncMgaPaymentSheetPlacement } from "../pay-sheets/mga-placement.js";
import { setMgaPaymentState } from "../policies/mga-payments.js";
import { LOGIN_PATH, registerAuthRoutes } from "./auth.js";
import {
  MY_COMMISSION_RECEIPT_PATH,
  registerMyCommissionReceiptRoute,
  registerMyCommissionsRoute,
} from "./my-commissions.js";

const PASSWORD = "StrongPass123!";
const SESSION_SECRET =
  "commission-receipt-db-test-secret-at-least-32-characters";
const MUTATION_AT = new Date("2026-07-11T12:00:00.000Z");

interface TestResponse {
  body: unknown;
  headers: Headers;
  statusCode: number;
}

test("producer receipt mark and unmark are owner-only, idempotent, and audit-atomic", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for receipt marker test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_stone122_receipt",
    async (isolatedUrl) => {
      const pool = createDatabasePool(isolatedUrl);
      const database = drizzle(pool, { schema: databaseSchema });
      const logger = new StructuredLogger({ write() {} });
      let server: Server | null = null;
      try {
        const references = await createPolicyReferenceFixture(database);
        const fixtureAccounts = await database
          .select({ email: users.email, id: users.id })
          .from(users)
          .where(
            inArray(users.id, [
              references.producerUserId,
              references.submittedByUserId,
            ]),
          );
        const emailById = new Map(
          fixtureAccounts.map((account) => [account.id, account.email]),
        );
        const producerEmail = emailById.get(references.producerUserId);
        const employeeEmail = emailById.get(references.submittedByUserId);
        assert.ok(producerEmail && employeeEmail);

        const admin = await createUser(database, {
          email: `stone122-admin-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        const otherProducer = await createUser(database, {
          email: `stone122-other-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        await database.insert(staffProfiles).values({
          displayName: "Receipt Other Producer",
          role: "producer",
          userId: otherProducer.id,
        });
        const producerContext = context(
          references.producerUserId,
          "producer",
        );
        const adminContext = context(admin.id, null, ["admin"]);

        await database.insert(producerRateHistory).values([
          {
            effectiveDate: "2000-01-01",
            newBrokerRate: "50.00",
            newCommissionRate: "25.00",
            producerUserId: references.producerUserId,
            renewalBrokerRate: "30.00",
            renewalCommissionRate: "20.00",
          },
          {
            effectiveDate: "2000-01-01",
            newBrokerRate: "10.00",
            newCommissionRate: "10.00",
            producerUserId: otherProducer.id,
            renewalBrokerRate: "10.00",
            renewalCommissionRate: "10.00",
          },
        ]);

        const [openPolicy, closedPolicy, expiredPolicy, otherPolicy] =
          await database
            .insert(policies)
            .values([
              approvedPolicy(references, {
                insuredName: "Receipt Open Own",
                policyNumber: "STONE-122-OPEN",
              }),
              approvedPolicy(references, {
                insuredName: "Receipt Closed Own",
                policyNumber: "STONE-122-CLOSED",
              }),
              approvedPolicy(references, {
                insuredName: "Receipt Expired Own",
                policyNumber: "STONE-122-EXPIRED",
                producerCommissionReceivedAt: new Date(
                  "2026-06-10T11:59:59.000Z",
                ),
              }),
              approvedPolicy(references, {
                insuredName: "Receipt Other Secret",
                policyNumber: "STONE-122-OTHER",
                producerUserId: otherProducer.id,
              }),
            ])
            .returning();
        assert.ok(openPolicy && closedPolicy && expiredPolicy && otherPolicy);

        const sheetTime = new Date("2026-07-01T00:00:00.000Z");
        const sheets = await database
          .insert(paySheets)
          .values([
            {
              createdAt: sheetTime,
              openedAt: sheetTime,
              ownerType: "sophia",
              ownerUserId: admin.id,
              periodMonth: 6,
              periodYear: 2026,
              updatedAt: sheetTime,
            },
            {
              createdAt: sheetTime,
              openedAt: sheetTime,
              ownerType: "producer",
              ownerUserId: references.producerUserId,
              periodMonth: 6,
              periodYear: 2026,
              updatedAt: sheetTime,
            },
          ])
          .returning();
        const producerSheet = sheets.find(
          (sheet) => sheet.ownerType === "producer",
        );
        assert.ok(producerSheet);
        const paidAt = new Date();
        await setMgaPaymentState(
          database,
          adminContext,
          closedPolicy.id,
          "paid",
          null,
          logger,
          paidAt,
        );
        await syncMgaPaymentSheetPlacement(
          database,
          adminContext,
          closedPolicy.id,
          true,
          logger,
          paidAt,
        );
        await closePaySheet(
          database,
          adminContext,
          producerSheet.id,
          logger,
        );
        const frozenBefore = await frozenState(database, closedPolicy.id);
        const financialBefore = await protectedPolicyState(
          database,
          openPolicy.id,
        );
        const closedFinancialBefore = await protectedPolicyState(
          database,
          closedPolicy.id,
        );
        const associationsBefore = await associationState(
          database,
          closedPolicy.id,
        );
        const ratesBefore = await rateState(database);

        const authorization = createDatabaseAuthorizationGuards(
          database,
          logger,
        );
        const app = createApp({
          logger,
          registerRoutes(routes) {
            registerAuthRoutes(routes, { database, logger });
            registerMyCommissionsRoute(routes, {
              authorization,
              list: (requestContext, query) =>
                listMyCommissionSources(
                  database,
                  requestContext,
                  query,
                  MUTATION_AT,
                ),
              logger,
            });
            registerMyCommissionReceiptRoute(routes, {
              authorization,
              change: (requestContext, policyId, input) =>
                setProducerCommissionReceipt(
                  database,
                  requestContext,
                  policyId,
                  input,
                  logger,
                  MUTATION_AT,
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
        const producerCookie = await login(running.baseUrl, producerEmail);
        const otherCookie = await login(running.baseUrl, otherProducer.email);
        const employeeCookie = await login(running.baseUrl, employeeEmail);
        const adminCookie = await login(running.baseUrl, admin.email);

        const marked = await changeReceipt(
          running.baseUrl,
          producerCookie,
          openPolicy.id,
          true,
        );
        assert.equal(marked.statusCode, 200);
        assert.equal(marked.headers.get("cache-control"), "no-store");
        assert.deepEqual(marked.body, {
          estimate: false,
          id: openPolicy.id,
          insuredName: "Receipt Open Own",
          payout: "25.00",
          policyType: frozenBefore.policyTypeName,
          receivedAt: MUTATION_AT.toISOString(),
          section: "paid",
          status: "received",
          transactionType: "New",
        });
        assertMinimalMutationResponse(marked.body);
        assert.deepEqual(await receiptAuditState(database, openPolicy.id), [
          {
            action: "producer_commission_receipt_marked",
            actorUserId: references.producerUserId,
            afterSummary: { received: true },
            beforeSummary: { received: false },
            entityId: openPolicy.id,
            entityType: "policy",
          },
        ]);

        const repeatedMark = await changeReceipt(
          running.baseUrl,
          producerCookie,
          openPolicy.id,
          true,
        );
        assert.equal(repeatedMark.statusCode, 200);
        assert.equal((repeatedMark.body as any).receivedAt, MUTATION_AT.toISOString());
        assert.equal((await receiptAuditState(database, openPolicy.id)).length, 1);

        const unmarked = await changeReceipt(
          running.baseUrl,
          producerCookie,
          openPolicy.id,
          false,
        );
        assert.equal(unmarked.statusCode, 200);
        assert.equal((unmarked.body as any).receivedAt, null);
        assert.equal((unmarked.body as any).section, "owed");
        assert.deepEqual(
          (await receiptAuditState(database, openPolicy.id)).map(
            ({ action, afterSummary, beforeSummary }) => ({
              action,
              afterSummary,
              beforeSummary,
            }),
          ),
          [
            {
              action: "producer_commission_receipt_marked",
              afterSummary: { received: true },
              beforeSummary: { received: false },
            },
            {
              action: "producer_commission_receipt_unmarked",
              afterSummary: { received: false },
              beforeSummary: { received: true },
            },
          ],
        );
        await changeReceipt(
          running.baseUrl,
          producerCookie,
          openPolicy.id,
          false,
        );
        assert.equal((await receiptAuditState(database, openPolicy.id)).length, 2);

        const closedMark = await changeReceipt(
          running.baseUrl,
          producerCookie,
          closedPolicy.id,
          true,
        );
        assert.equal(closedMark.statusCode, 200);
        assert.equal((closedMark.body as any).payout, "25.00");
        assert.deepEqual(await frozenState(database, closedPolicy.id), frozenBefore);

        for (const denied of [
          { cookie: undefined, policyId: openPolicy.id, status: 401 },
          { cookie: employeeCookie, policyId: openPolicy.id, status: 403 },
          { cookie: adminCookie, policyId: openPolicy.id, status: 403 },
          { cookie: otherCookie, policyId: openPolicy.id, status: 404 },
          { cookie: producerCookie, policyId: otherPolicy.id, status: 404 },
          { cookie: producerCookie, policyId: expiredPolicy.id, status: 404 },
        ]) {
          const response = await changeReceipt(
            running.baseUrl,
            denied.cookie,
            denied.policyId,
            false,
          );
          assert.equal(response.statusCode, denied.status);
          const serialized = JSON.stringify(response.body);
          assert.equal(serialized.includes("Receipt Open Own"), false);
          assert.equal(serialized.includes("payout"), false);
        }
        const [expiredAfter] = await database
          .select({ value: policies.producerCommissionReceivedAt })
          .from(policies)
          .where(eq(policies.id, expiredPolicy.id));
        assert.equal(
          expiredAfter?.value?.toISOString(),
          "2026-06-10T11:59:59.000Z",
        );

        await forceAuditFailure(pool);
        try {
          await assert.rejects(
            setProducerCommissionReceipt(
              database,
              producerContext,
              openPolicy.id,
              { received: true },
              logger,
              new Date("2026-07-11T13:00:00.000Z"),
            ),
            (error: unknown) => readDatabaseErrorCode(error) === "55000",
          );
        } finally {
          await removeAuditFailure(pool);
        }
        const [rolledBack] = await database
          .select({ value: policies.producerCommissionReceivedAt })
          .from(policies)
          .where(eq(policies.id, openPolicy.id));
        assert.equal(rolledBack?.value, null);
        assert.equal((await receiptAuditState(database, openPolicy.id)).length, 2);

        const concurrentAt = new Date("2026-07-11T14:00:00.000Z");
        const concurrent = await Promise.all([
          setProducerCommissionReceipt(
            database,
            producerContext,
            openPolicy.id,
            { received: true },
            logger,
            concurrentAt,
          ),
          setProducerCommissionReceipt(
            database,
            producerContext,
            openPolicy.id,
            { received: true },
            logger,
            concurrentAt,
          ),
        ]);
        assert.deepEqual(
          concurrent.map(({ changed }) => changed).sort(),
          [false, true],
        );
        const finalAudits = await receiptAuditState(database, openPolicy.id);
        assert.equal(
          finalAudits.filter(
            ({ action }) =>
              action === "producer_commission_receipt_marked",
          ).length,
          2,
        );
        const [concurrentPolicy] = await database
          .select({ value: policies.producerCommissionReceivedAt })
          .from(policies)
          .where(eq(policies.id, openPolicy.id));
        assert.equal(concurrentPolicy?.value?.toISOString(), concurrentAt.toISOString());

        assert.deepEqual(
          await protectedPolicyState(database, openPolicy.id),
          financialBefore,
        );
        assert.deepEqual(
          await protectedPolicyState(database, closedPolicy.id),
          closedFinancialBefore,
        );
        assert.deepEqual(
          await associationState(database, closedPolicy.id),
          associationsBefore,
        );
        assert.deepEqual(await frozenState(database, closedPolicy.id), frozenBefore);
        assert.deepEqual(await rateState(database), ratesBefore);
      } finally {
        if (server !== null) await closeServer(server);
        await pool.end();
      }
    },
  );
});

function approvedPolicy(
  references: PolicyReferenceFixture,
  overrides: Parameters<typeof policyTestInput>[1] = {},
) {
  return policyTestInput(references, {
    accountAssignment: "book",
    amountPaid: "1000.00",
    basePremium: "1000.00",
    brokerFee: "0.00",
    commissionAmount: "100.00",
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "10.0000",
    kayleeSplit: "book",
    netDue: "900.00",
    policyNumber: `STONE-122-${randomUUID()}`,
    producerUserId: references.producerUserId,
    proposalTotal: "1000.00",
    sourceDraftId: null,
    ...overrides,
  });
}

function context(
  userId: string,
  staffRole: "employee" | "producer" | null,
  capabilities: readonly "admin"[] = [],
): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: [...capabilities],
      staffRole,
      userActive: true,
      userId,
    },
  };
}

async function receiptAuditState(
  database: ReturnType<typeof drizzle<typeof databaseSchema>>,
  policyId: string,
) {
  const rows = await database
    .select({
      action: auditEvents.action,
      actorUserId: auditEvents.actorUserId,
      afterSummary: auditEvents.afterSummary,
      beforeSummary: auditEvents.beforeSummary,
      entityId: auditEvents.entityId,
      entityType: auditEvents.entityType,
      occurredAt: auditEvents.occurredAt,
    })
    .from(auditEvents)
    .where(eq(auditEvents.entityId, policyId));
  return rows
    .filter(({ action }) => action.startsWith("producer_commission_receipt_"))
    .sort((left, right) =>
      left.occurredAt.getTime() - right.occurredAt.getTime(),
    )
    .map(({ occurredAt: _occurredAt, ...row }) => row);
}

async function protectedPolicyState(
  database: ReturnType<typeof drizzle<typeof databaseSchema>>,
  policyId: string,
) {
  const [row] = await database
    .select({
      amountPaid: policies.amountPaid,
      brokerFee: policies.brokerFee,
      commissionAmount: policies.commissionAmount,
      commissionMode: policies.commissionMode,
      commissionRate: policies.commissionRate,
      mgaPaid: policies.mgaPaid,
      mgaPaidAt: policies.mgaPaidAt,
      mgaPayReference: policies.mgaPayReference,
      netDue: policies.netDue,
      producerUserId: policies.producerUserId,
      updatedAt: policies.updatedAt,
    })
    .from(policies)
    .where(eq(policies.id, policyId));
  return row;
}

async function frozenState(
  database: ReturnType<typeof drizzle<typeof databaseSchema>>,
  policyId: string,
) {
  const rows = await database
    .select({
      frozenPolicySnapshot: paySheetPolicies.frozenPolicySnapshot,
      frozenRateSnapshot: paySheetPolicies.frozenRateSnapshot,
      ownerType: paySheets.ownerType,
    })
    .from(paySheetPolicies)
    .innerJoin(paySheets, eq(paySheets.id, paySheetPolicies.paySheetId))
    .where(eq(paySheetPolicies.policyId, policyId));
  const producer = rows.find(({ ownerType }) => ownerType === "producer");
  assert.ok(producer);
  const snapshot = producer.frozenPolicySnapshot as Record<string, unknown>;
  return {
    frozenPolicySnapshot: producer.frozenPolicySnapshot,
    frozenRateSnapshot: producer.frozenRateSnapshot,
    policyTypeName: String(snapshot.policyTypeName),
  };
}

async function associationState(
  database: ReturnType<typeof drizzle<typeof databaseSchema>>,
  policyId: string,
) {
  return database
    .select({
      associationId: paySheetPolicies.id,
      paySheetId: paySheetPolicies.paySheetId,
      policyId: paySheetPolicies.policyId,
    })
    .from(paySheetPolicies)
    .where(eq(paySheetPolicies.policyId, policyId))
    .orderBy(paySheetPolicies.id);
}

async function rateState(
  database: ReturnType<typeof drizzle<typeof databaseSchema>>,
) {
  return database
    .select()
    .from(producerRateHistory)
    .orderBy(producerRateHistory.producerUserId, producerRateHistory.effectiveDate);
}

async function forceAuditFailure(pool: ReturnType<typeof createDatabasePool>) {
  await pool.query(`
    CREATE FUNCTION fail_commission_receipt_audit_for_test()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.action IN (
        'producer_commission_receipt_marked',
        'producer_commission_receipt_unmarked'
      ) THEN
        RAISE EXCEPTION 'forced commission receipt audit failure'
          USING ERRCODE = '55000';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await pool.query(`
    CREATE TRIGGER fail_commission_receipt_audit_for_test_trigger
    BEFORE INSERT ON audit_events
    FOR EACH ROW
    EXECUTE FUNCTION fail_commission_receipt_audit_for_test()
  `);
}

async function removeAuditFailure(pool: ReturnType<typeof createDatabasePool>) {
  await pool.query(
    "DROP TRIGGER fail_commission_receipt_audit_for_test_trigger ON audit_events",
  );
  await pool.query("DROP FUNCTION fail_commission_receipt_audit_for_test() ");
}

function assertMinimalMutationResponse(body: unknown): void {
  assert.deepEqual(Object.keys(body as object), [
    "estimate",
    "id",
    "insuredName",
    "payout",
    "policyType",
    "receivedAt",
    "section",
    "status",
    "transactionType",
  ]);
  const serialized = JSON.stringify(body);
  for (const forbidden of [
    "policyNumber",
    "producerUserId",
    "commissionAmount",
    "commissionRate",
    "brokerFee",
    "netDue",
    "mgaId",
    "carrierId",
    "ipfsFinanced",
    "sophiaShare",
    "agencyRevenue",
  ]) {
    assert.equal(serialized.includes(`\"${forbidden}\"`), false, forbidden);
  }
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

async function changeReceipt(
  baseUrl: string,
  cookie: string | undefined,
  policyId: string,
  received: boolean,
): Promise<TestResponse> {
  return request(baseUrl, {
    body: { received },
    cookie,
    method: "PUT",
    path: MY_COMMISSION_RECEIPT_PATH.replace(":policyId", policyId),
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
