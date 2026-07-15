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
import * as databaseSchema from "../db/schema.js";
import {
  mgas,
  policies,
  userCapabilities,
  users,
} from "../db/schema.js";
import { StructuredLogger } from "../logging/logger.js";
import {
  listMgaPayableSources,
} from "../policies/mga-payables.js";
import { setMgaPaymentState } from "../policies/mga-payments.js";
import { applyPolicyOverride } from "../policies/overrides.js";
import { LOGIN_PATH, registerAuthRoutes } from "./auth.js";
import {
  MGA_PAYABLES_PATH,
  registerMgaPayableRoute,
} from "./mga-payables.js";

const PASSWORD = "StrongPass123!";
const SESSION_SECRET = "mga-payables-db-test-secret-at-least-32-characters";

interface TestResponse {
  body: unknown;
  headers: Headers;
  statusCode: number;
}

test("MGA payable endpoint composes exact stored values and admin access", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for MGA payable test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_mga_payables",
    async (isolatedUrl) => {
      const pool = createDatabasePool(isolatedUrl);
      const database = drizzle(pool, { schema: databaseSchema });
      const logger = new StructuredLogger({ write() {} });
      let server: Server | null = null;
      try {
        const admin = await createUser(database, {
          email: `mga-payables-admin-${randomUUID()}@example.test`,
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
          .where(
            inArray(users.id, [
              references.submittedByUserId,
              references.producerUserId,
            ]),
          );
        const emailById = new Map(
          fixtureUsers.map((user) => [user.id, user.email]),
        );
        const suffix = randomUUID();
        const [alphaMga, bravoMga] = await database
          .insert(mgas)
          .values([
            { name: `Alpha MGA ${suffix}` },
            { name: `Bravo MGA ${suffix}` },
          ])
          .returning({ id: mgas.id, name: mgas.name });
        assert.ok(alphaMga && bravoMga);

        const approvedAt = new Date("2026-07-11T12:00:00.000Z");
        const [paidOverride, alphaUnpaid, bravoUnpaid] = await database
          .insert(policies)
          .values([
            policyTestInput(references, {
              accountAssignment: "book",
              amountPaid: "900.00",
              approvedAt,
              basePremium: "1000.00",
              brokerFee: "50.00",
              commissionAmount: "100.00",
              commissionConfirmed: true,
              commissionMode: "pct",
              commissionRate: "10.0000",
              createdAt: approvedAt,
              insuredName: "alpha insured",
              kayleeSplit: "book",
              mgaId: alphaMga.id,
              netDue: "750.00",
              paymentMode: "full",
              policyNumber: "MGA-PAID-OVERRIDE",
              producerUserId: references.producerUserId,
              proposalTotal: "1050.00",
              sourceDraftId: null,
              updatedAt: approvedAt,
            }),
            policyTestInput(references, {
              accountAssignment: "none",
              amountPaid: "150.10",
              approvedAt,
              basePremium: "1000.00",
              brokerFee: "50.00",
              commissionAmount: "100.00",
              commissionConfirmed: true,
              commissionMode: "pct",
              commissionRate: "10.0000",
              insuredName: "Beta Insured",
              kayleeSplit: "none",
              mgaId: alphaMga.id,
              netDue: "0.10",
              paymentMode: "full",
              policyNumber: "MGA-ALPHA-UNPAID",
              producerUserId: null,
              proposalTotal: "1050.00",
              sourceDraftId: null,
            }),
            policyTestInput(references, {
              accountAssignment: "none",
              amountPaid: "150.20",
              approvedAt,
              basePremium: "1000.00",
              brokerFee: "50.00",
              commissionAmount: "100.00",
              commissionConfirmed: true,
              commissionMode: "pct",
              commissionRate: "10.0000",
              insuredName: "Zulu Insured",
              kayleeSplit: "none",
              mgaId: bravoMga.id,
              netDue: "0.20",
              paymentMode: "full",
              policyNumber: "MGA-BRAVO-UNPAID",
              producerUserId: null,
              proposalTotal: "1050.00",
              sourceDraftId: null,
            }),
          ])
          .returning({ id: policies.id });
        assert.ok(paidOverride && alphaUnpaid && bravoUnpaid);
        await applyPolicyOverride(
          database,
          context,
          paidOverride.id,
          "Verify stored payable override",
          { netDue: "0.20" },
          ["netDue"],
          logger,
          new Date("2026-07-11T12:01:00.000Z"),
        );
        await setMgaPaymentState(
          database,
          context,
          paidOverride.id,
          "paid",
          "MGA-REF-1",
          logger,
          new Date("2026-07-11T12:02:00.000Z"),
        );

        const authorization = createDatabaseAuthorizationGuards(
          database,
          logger,
        );
        const app = createApp({
          logger,
          registerRoutes(routes) {
            registerAuthRoutes(routes, { database, logger });
            registerMgaPayableRoute(routes, {
              authorization,
              list: (requestContext, query) =>
                listMgaPayableSources(database, requestContext, query),
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

        const all = await request(running.baseUrl, {
          cookie: adminCookie,
          path: `${MGA_PAYABLES_PATH}?status=all`,
        });
        assert.equal(all.statusCode, 200);
        assert.equal(all.headers.get("cache-control"), "no-store");
        const allBody = all.body as any;
        assert.deepEqual(
          allBody.groups.map((group: any) => group.mgaName),
          [alphaMga.name, bravoMga.name],
        );
        assert.deepEqual(
          allBody.groups[0].items.map((item: any) => item.insuredName),
          ["alpha insured", "Beta Insured"],
        );
        assert.deepEqual(allBody.summary, {
          outstandingAmount: "0.30",
          paidAmount: "0.20",
          paidCount: 1,
          totalCount: 3,
          unpaidCount: 2,
        });
        const paidItem = allBody.groups[0].items[0];
        assert.equal(paidItem.policyId, paidOverride.id);
        assert.equal(paidItem.netDue, "0.20");
        assert.equal(paidItem.overridden, true);
        assert.equal(paidItem.status, "paid");
        assert.equal(paidItem.paymentReference, "MGA-REF-1");
        assert.equal(paidItem.amountPaid, "900.00");
        assert.equal(paidItem.brokerFee, "50.00");
        assert.equal(paidItem.commissionAmount, "100.00");
        assert.equal(paidItem.commissionRate, "10.0000");
        assert.equal("basePremium" in paidItem, false);

        const unpaid = await request(running.baseUrl, {
          cookie: adminCookie,
          path: `${MGA_PAYABLES_PATH}?status=unpaid`,
        });
        const unpaidBody = unpaid.body as any;
        assert.equal(unpaidBody.groups[0].items.length, 1);
        assert.equal(unpaidBody.groups[0].items[0].policyId, alphaUnpaid.id);
        assert.deepEqual(unpaidBody.summary, allBody.summary);
        assert.deepEqual(unpaidBody.groups[0].totals, {
          outstandingAmount: "0.10",
          paidAmount: "0.20",
          paidCount: 1,
          totalCount: 2,
          unpaidCount: 1,
        });

        const paid = await request(running.baseUrl, {
          cookie: adminCookie,
          path: `${MGA_PAYABLES_PATH}?status=paid`,
        });
        const paidBody = paid.body as any;
        assert.equal(paidBody.groups.length, 1);
        assert.equal(paidBody.groups[0].items[0].policyId, paidOverride.id);
        assert.deepEqual(paidBody.summary, allBody.summary);

        for (const cookie of [employeeCookie, producerCookie]) {
          const denied = await request(running.baseUrl, {
            cookie,
            path: `${MGA_PAYABLES_PATH}?status=all`,
          });
          assert.equal(denied.statusCode, 403);
          assert.deepEqual(denied.body, {
            error: { code: "forbidden", message: "Forbidden" },
          });
          const serialized = JSON.stringify(denied.body);
          assert.equal(serialized.includes("netDue"), false);
          assert.equal(serialized.includes("alpha insured"), false);
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
