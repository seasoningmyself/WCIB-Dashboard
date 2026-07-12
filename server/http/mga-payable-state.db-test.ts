import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Express } from "express";
import pg from "pg";
import { test } from "node:test";
import { createApp } from "../app.js";
import {
  createDatabaseAuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import { createSessionMiddleware } from "../auth/sessions.js";
import { createUser, type AuthDatabase } from "../auth/users.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
} from "../db/policy-test-fixture.js";
import * as databaseSchema from "../db/schema.js";
import {
  auditEvents,
  mgaPayments,
  paySheetPolicies,
  paySheets,
  policies,
  producerRateHistory,
  userCapabilities,
  users,
} from "../db/schema.js";
import type { AppLogger, LogContext } from "../logging/logger.js";
import { closePaySheet } from "../pay-sheets/close.js";
import { changeMgaPayableState } from "../policies/mga-payable-state.js";
import { LOGIN_PATH, registerAuthRoutes } from "./auth.js";
import {
  MGA_PAYABLE_STATE_PATH,
  registerMgaPayableStateRoute,
} from "./mga-payable-state.js";

const PASSWORD = "StrongPass123!";
const SESSION_SECRET =
  "mga-payable-state-db-test-secret-at-least-32-characters";

interface LoggedEvent {
  context: LogContext;
  level: "error" | "info" | "warn";
  message: string;
}

interface TestResponse {
  body: unknown;
  headers: Headers;
  statusCode: number;
}

test("MGA payable endpoint keeps state, placement, audit, and closed history atomic", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for MGA state test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_mga_state",
    async (isolatedUrl) => {
      const pool = new pg.Pool({ connectionString: isolatedUrl, max: 8 });
      const database = drizzle(pool, { schema: databaseSchema });
      const loggedEvents: LoggedEvent[] = [];
      const logger = capturingLogger(loggedEvents);
      let server: Server | null = null;
      try {
        const admin = await createUser(database, {
          email: `mga-state-admin-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const context = adminContext(admin.id);
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
        const createdAt = new Date(Date.now() - 120_000);
        const [sophiaSheet, producerSheet] = await database
          .insert(paySheets)
          .values([
            {
              createdAt,
              openedAt: createdAt,
              ownerType: "sophia",
              ownerUserId: admin.id,
              periodMonth: 7,
              periodYear: 2026,
              updatedAt: createdAt,
            },
            {
              createdAt,
              openedAt: createdAt,
              ownerType: "producer",
              ownerUserId: references.producerUserId,
              periodMonth: 7,
              periodYear: 2026,
              updatedAt: createdAt,
            },
          ])
          .returning();
        assert.ok(sophiaSheet && producerSheet);
        await database.insert(producerRateHistory).values({
          effectiveDate: "2000-01-01",
          newBrokerRate: "25.00",
          newCommissionRate: "25.00",
          producerUserId: references.producerUserId,
          renewalBrokerRate: "25.00",
          renewalCommissionRate: "25.00",
        });

        const financial = {
          accountAssignment: "book" as const,
          amountPaid: "1000.00",
          basePremium: "1000.00",
          brokerFee: "50.00",
          commissionAmount: "100.00",
          commissionConfirmed: true,
          commissionMode: "pct" as const,
          commissionRate: "10.0000",
          createdAt,
          financeBalance: "0.00",
          kayleeSplit: "book" as const,
          netDue: "850.00",
          paymentMode: "full" as const,
          producerUserId: references.producerUserId,
          proposalTotal: "1050.00",
          sourceDraftId: null,
          updatedAt: createdAt,
        };
        const [closedHistoryPolicy, openDetachPolicy, rollbackPolicy] =
          await database
            .insert(policies)
            .values([
              policyTestInput(references, {
                ...financial,
                insuredName: "Closed History Insured",
                policyNumber: "MGA-CLOSED-HISTORY",
              }),
              policyTestInput(references, {
                ...financial,
                insuredName: "Concurrent Insured",
                policyNumber: "MGA-CONCURRENT",
              }),
              policyTestInput(references, {
                ...financial,
                insuredName: "Rollback Insured",
                policyNumber: "MGA-ROLLBACK",
              }),
            ])
            .returning();
        assert.ok(closedHistoryPolicy && openDetachPolicy && rollbackPolicy);

        const authorization = createDatabaseAuthorizationGuards(
          database,
          logger,
        );
        const app = createApp({
          logger,
          registerRoutes(routes) {
            registerAuthRoutes(routes, { database, logger });
            registerMgaPayableStateRoute(routes, {
              authorization,
              change: (requestContext, policyId, input) =>
                changeMgaPayableState(
                  database,
                  requestContext,
                  policyId,
                  input,
                  logger,
                ),
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

        for (const cookie of [employeeCookie, producerCookie]) {
          const denied = await mutate(
            running.baseUrl,
            rollbackPolicy.id,
            cookie,
            { status: "paid" },
          );
          assert.equal(denied.statusCode, 403);
          assert.deepEqual(denied.body, {
            error: { code: "forbidden", message: "Forbidden" },
          });
        }
        assert.deepEqual(
          await database
            .select()
            .from(mgaPayments)
            .where(eq(mgaPayments.policyId, rollbackPolicy.id)),
          [],
        );

        const markedClosed = await mutate(
          running.baseUrl,
          closedHistoryPolicy.id,
          adminCookie,
          { reference: "SECRET-CLOSED-REF", status: "paid" },
        );
        assert.equal(markedClosed.statusCode, 200);
        assert.equal(markedClosed.headers.get("cache-control"), "no-store");
        assert.deepEqual(
          new Set((markedClosed.body as any).placement.paySheetIds),
          new Set([sophiaSheet.id, producerSheet.id]),
        );
        assert.equal((markedClosed.body as any).item.status, "paid");
        assert.equal((markedClosed.body as any).item.netDue, "850.00");
        assert.equal("amountPaid" in (markedClosed.body as any).item, false);

        const repeatedClosed = await mutate(
          running.baseUrl,
          closedHistoryPolicy.id,
          adminCookie,
          { reference: "SECRET-CLOSED-REF", status: "paid" },
        );
        assert.deepEqual((repeatedClosed.body as any).placement, {
          associationCount: 0,
          paySheetIds: [],
        });
        assert.deepEqual(
          actionCounts(
            await database.select().from(auditEvents),
            closedHistoryPolicy.id,
          ),
          {
            mga_payment_marked_paid: 1,
            mga_payment_sheet_attached: 2,
          },
        );

        await pool.query(`
          CREATE FUNCTION slow_parent_f_payment_for_test()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            PERFORM pg_sleep(0.15);
            RETURN NEW;
          END;
          $$
        `);
        await pool.query(`
          CREATE TRIGGER slow_parent_f_payment_for_test_trigger
          BEFORE INSERT ON mga_payments
          FOR EACH ROW
          EXECUTE FUNCTION slow_parent_f_payment_for_test()
        `);
        const concurrent = await Promise.all([
          mutate(running.baseUrl, openDetachPolicy.id, adminCookie, {
            reference: "SECRET-CONCURRENT-REF",
            status: "paid",
          }),
          mutate(running.baseUrl, openDetachPolicy.id, adminCookie, {
            reference: "SECRET-CONCURRENT-REF",
            status: "paid",
          }),
        ]);
        assert.deepEqual(
          concurrent.map(
            (response) => (response.body as any).placement.associationCount,
          ).sort(),
          [0, 2],
        );
        await pool.query(
          "DROP TRIGGER slow_parent_f_payment_for_test_trigger ON mga_payments",
        );
        await pool.query("DROP FUNCTION slow_parent_f_payment_for_test() ");
        assert.equal(
          (
            await database
              .select()
              .from(paySheetPolicies)
              .where(eq(paySheetPolicies.policyId, openDetachPolicy.id))
          ).length,
          2,
        );

        const openUnmark = await mutate(
          running.baseUrl,
          openDetachPolicy.id,
          adminCookie,
          { status: "unpaid" },
        );
        assert.equal(openUnmark.statusCode, 200);
        assert.equal((openUnmark.body as any).placement.associationCount, 2);
        assert.equal((openUnmark.body as any).item.status, "unpaid");
        assert.equal((openUnmark.body as any).item.paymentReference, null);
        assert.deepEqual(
          await database
            .select()
            .from(paySheetPolicies)
            .where(eq(paySheetPolicies.policyId, openDetachPolicy.id)),
          [],
        );

        const producerClose = await closePaySheet(
          database,
          context,
          producerSheet.id,
          logger,
        );
        const sophiaClose = await closePaySheet(
          database,
          context,
          sophiaSheet.id,
          logger,
        );
        assert.ok(producerClose.nextSheetId && sophiaClose.nextSheetId);
        const closedAssociationsBefore = await database
          .select()
          .from(paySheetPolicies)
          .where(eq(paySheetPolicies.policyId, closedHistoryPolicy.id));
        const closedSheetsBefore = await database
          .select()
          .from(paySheets)
          .where(inArray(paySheets.id, [sophiaSheet.id, producerSheet.id]));
        assert.equal(closedAssociationsBefore.length, 2);
        assert.equal(
          closedAssociationsBefore.every(
            (association) =>
              association.frozenPolicySnapshot !== null,
          ),
          true,
        );
        assert.equal(
          closedAssociationsBefore.find(
            (association) => association.paySheetId === sophiaSheet.id,
          )?.frozenRateSnapshot,
          null,
        );
        assert.notEqual(
          closedAssociationsBefore.find(
            (association) => association.paySheetId === producerSheet.id,
          )?.frozenRateSnapshot,
          null,
        );
        assert.equal(
          closedSheetsBefore.every((sheet) => sheet.frozenTotals !== null),
          true,
        );

        const closedUnmark = await mutate(
          running.baseUrl,
          closedHistoryPolicy.id,
          adminCookie,
          { status: "unpaid" },
        );
        assert.equal((closedUnmark.body as any).placement.associationCount, 0);
        assert.deepEqual(
          await database
            .select()
            .from(paySheetPolicies)
            .where(eq(paySheetPolicies.policyId, closedHistoryPolicy.id)),
          closedAssociationsBefore,
        );
        assert.deepEqual(
          await database
            .select()
            .from(paySheets)
            .where(inArray(paySheets.id, [sophiaSheet.id, producerSheet.id])),
          closedSheetsBefore,
        );

        const paidAgain = await mutate(
          running.baseUrl,
          closedHistoryPolicy.id,
          adminCookie,
          { status: "paid" },
        );
        assert.deepEqual((paidAgain.body as any).placement, {
          associationCount: 0,
          paySheetIds: [],
        });
        assert.equal(
          (
            await database
              .select()
              .from(paySheetPolicies)
              .where(eq(paySheetPolicies.policyId, closedHistoryPolicy.id))
          ).length,
          2,
        );

        await pool.query(`
          CREATE FUNCTION fail_parent_f_placement_audit_for_test()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF NEW.action = 'mga_payment_sheet_attached' THEN
              RAISE EXCEPTION 'forced placement audit failure'
                USING ERRCODE = '55000';
            END IF;
            RETURN NEW;
          END;
          $$
        `);
        await pool.query(`
          CREATE TRIGGER fail_parent_f_placement_audit_for_test_trigger
          BEFORE INSERT ON audit_events
          FOR EACH ROW
          EXECUTE FUNCTION fail_parent_f_placement_audit_for_test()
        `);
        const placementFailure = await mutate(
          running.baseUrl,
          rollbackPolicy.id,
          adminCookie,
          { reference: "SECRET-ROLLBACK-REF", status: "paid" },
        );
        assert.equal(placementFailure.statusCode, 409);
        await pool.query(
          "DROP TRIGGER fail_parent_f_placement_audit_for_test_trigger ON audit_events",
        );
        await pool.query(
          "DROP FUNCTION fail_parent_f_placement_audit_for_test() ",
        );
        await assertPolicyUnchangedAfterFailure(
          database,
          rollbackPolicy.id,
        );

        await pool.query(`
          CREATE FUNCTION fail_parent_f_state_audit_for_test()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $$
          BEGIN
            IF NEW.action = 'mga_payment_marked_paid' THEN
              RAISE EXCEPTION 'forced state audit failure'
                USING ERRCODE = '55000';
            END IF;
            RETURN NEW;
          END;
          $$
        `);
        await pool.query(`
          CREATE TRIGGER fail_parent_f_state_audit_for_test_trigger
          BEFORE INSERT ON audit_events
          FOR EACH ROW
          EXECUTE FUNCTION fail_parent_f_state_audit_for_test()
        `);
        const stateFailure = await mutate(
          running.baseUrl,
          rollbackPolicy.id,
          adminCookie,
          { reference: "SECRET-STATE-FAILURE", status: "paid" },
        );
        assert.equal(stateFailure.statusCode, 409);
        await pool.query(
          "DROP TRIGGER fail_parent_f_state_audit_for_test_trigger ON audit_events",
        );
        await pool.query("DROP FUNCTION fail_parent_f_state_audit_for_test() ");
        await assertPolicyUnchangedAfterFailure(
          database,
          rollbackPolicy.id,
        );

        const serializedLogs = JSON.stringify(loggedEvents);
        for (const secret of [
          "SECRET-CLOSED-REF",
          "SECRET-CONCURRENT-REF",
          "SECRET-ROLLBACK-REF",
          "SECRET-STATE-FAILURE",
        ]) {
          assert.equal(serializedLogs.includes(secret), false);
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

async function assertPolicyUnchangedAfterFailure(
  database: AuthDatabase,
  policyId: string,
): Promise<void> {
  const [policy] = await database
    .select()
    .from(policies)
    .where(eq(policies.id, policyId));
  assert.equal(policy?.mgaPaid, false);
  assert.equal(policy?.mgaPaidAt, null);
  assert.equal(policy?.mgaPayReference, null);
  assert.deepEqual(
    await database
      .select()
      .from(mgaPayments)
      .where(eq(mgaPayments.policyId, policyId)),
    [],
  );
  assert.deepEqual(
    await database
      .select()
      .from(paySheetPolicies)
      .where(eq(paySheetPolicies.policyId, policyId)),
    [],
  );
  const audits = await database.select().from(auditEvents);
  assert.deepEqual(actionCounts(audits, policyId), {});
}

function actionCounts(
  events: readonly (typeof auditEvents.$inferSelect)[],
  policyId: string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    const before = event.beforeSummary as Record<string, unknown> | null;
    const after = event.afterSummary as Record<string, unknown> | null;
    if (before?.policyId !== policyId && after?.policyId !== policyId) {
      continue;
    }
    counts[event.action] = (counts[event.action] ?? 0) + 1;
  }
  return counts;
}

function adminContext(userId: string): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: ["admin"],
      staffRole: null,
      userActive: true,
      userId,
    },
  };
}

function capturingLogger(events: LoggedEvent[]): AppLogger {
  return {
    error(message, context = {}) {
      events.push({ context, level: "error", message });
    },
    info(message, context = {}) {
      events.push({ context, level: "info", message });
    },
    warn(message, context = {}) {
      events.push({ context, level: "warn", message });
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

async function mutate(
  baseUrl: string,
  policyId: string,
  cookie: string,
  body: unknown,
): Promise<TestResponse> {
  return request(baseUrl, {
    body,
    cookie,
    method: "PUT",
    path: MGA_PAYABLE_STATE_PATH.replace(":policyId", policyId),
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
