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
  policies,
  userCapabilities,
  users,
} from "../db/schema.js";
import { StructuredLogger } from "../logging/logger.js";
import {
  getPolicyLedgerItem,
  listPolicyLedger,
} from "../policies/ledger.js";
import { setMgaPaymentState } from "../policies/mga-payments.js";
import { LOGIN_PATH, registerAuthRoutes } from "./auth.js";
import {
  POLICY_LEDGER_LIST_PATH,
  registerPolicyLedgerRoutes,
} from "./policies.js";

const PASSWORD = "StrongPass123!";
const SESSION_SECRET = "policy-ledger-db-test-secret-at-least-32-characters";

interface TestResponse {
  body: unknown;
  headers: Headers;
  statusCode: number;
}

test("policy ledger endpoints enforce admin sessions over a migrated database", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for policy ledger test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_policy_ledger",
    async (isolatedUrl) => {
      const pool = createDatabasePool(isolatedUrl);
      const database = drizzle(pool, { schema: databaseSchema });
      const logger = new StructuredLogger({ write() {} });
      let server: Server | null = null;
      try {
        const admin = await createUser(database, {
          email: `ledger-admin-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
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
        const submittedAt = new Date("2026-07-04T12:00:00.000Z");
        const [pendingFinance, completedFinance] = await database
          .insert(policies)
          .values([
            policyTestInput(references, {
              accountAssignment: "none",
              amountPaid: "350.00",
              approvedAt: new Date("2026-07-05T12:00:00.000Z"),
              basePremium: "1000.00",
              brokerFee: "50.00",
              commissionAmount: "125.00",
              commissionConfirmed: true,
              commissionMode: "pct",
              commissionRate: "12.5000",
              createdAt: new Date("2026-07-05T12:00:00.000Z"),
              financeBalance: "725.00",
              financeContact: { email: "billing@example.test" },
              financeMeta: { source: "ipfs" },
              financeReference: "IPFS-PENDING",
              insuredName: "Acme Construction",
              ipfsFinanced: "yes",
              ipfsReturning: "new",
              kayleeSplit: "none",
              mgaFee: "25.00",
              netDue: "175.00",
              paymentMode: "deposit",
              policyNumber: "GL-100",
              producerUserId: null,
              proposalTotal: "1075.00",
              sourceDraftId: null,
              submittedAt,
              taxes: "0.00",
              updatedAt: new Date("2026-07-05T12:00:00.000Z"),
            }),
            policyTestInput(references, {
              accountAssignment: "book",
              amountPaid: "350.00",
              approvedAt: new Date("2026-07-06T12:00:00.000Z"),
              basePremium: "1000.00",
              brokerFee: "50.00",
              commissionAmount: "125.00",
              commissionConfirmed: true,
              commissionMode: "pct",
              commissionRate: "12.5000",
              createdAt: new Date("2026-07-06T12:00:00.000Z"),
              financeBalance: "725.00",
              financeContact: { email: "billing@example.test" },
              financeMeta: { source: "ipfs" },
              financeReference: "IPFS-COMPLETE",
              insuredName: "acme  construction",
              ipfsFinanced: "yes",
              ipfsPushed: true,
              ipfsPushedAt: new Date("2026-07-07T12:00:00.000Z"),
              ipfsReturning: "returning",
              kayleeSplit: "book",
              mgaFee: "25.00",
              netDue: "175.00",
              paymentMode: "deposit",
              policyNumber: "gl-100",
              producerUserId: references.producerUserId,
              proposalTotal: "1075.00",
              sourceDraftId: null,
              submittedAt,
              submittedByUserId: references.producerUserId,
              taxes: "0.00",
              updatedAt: new Date("2026-07-06T12:00:00.000Z"),
            }),
          ])
          .returning({ id: policies.id });
        assert.ok(pendingFinance && completedFinance);
        await setMgaPaymentState(
          database,
          {
            principal: {
              capabilities: ["admin"],
              staffRole: null,
              userActive: true,
              userId: admin.id,
            },
          },
          completedFinance.id,
          "paid",
          "MGA-PAID-1",
          logger,
          new Date("2026-07-07T13:00:00.000Z"),
        );

        const authorization = createDatabaseAuthorizationGuards(
          database,
          logger,
        );
        const app = createApp({
          logger,
          registerRoutes(routes) {
            registerAuthRoutes(routes, { database, logger });
            registerPolicyLedgerRoutes(routes, {
              authorization,
              get: (context, policyId) =>
                getPolicyLedgerItem(database, context, policyId),
              list: (context, query) =>
                listPolicyLedger(database, context, query),
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

        const adminCookie = await login(
          running.baseUrl,
          admin.email,
        );
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
          path: `${POLICY_LEDGER_LIST_PATH}?month=2026-07&sort=insured`,
        });
        assert.equal(list.statusCode, 200);
        assert.equal(list.headers.get("cache-control"), "no-store");
        const body = list.body as any;
        assert.equal(body.total, 2);
        assert.equal(body.filteredTotal, 2);
        assert.equal(body.items.length, 2);
        assert.equal(body.items[0].duplicate.kind, "likely");
        assert.equal(body.items[1].duplicate.kind, "likely");
        assert.equal(body.items[0].labels.carrierName.startsWith("Policy Carrier"), true);
        assert.equal(body.totals.agencyRevenue, "350.00");
        assert.equal(body.totals.producerPayout, "43.75");
        assert.equal(body.totals.sophiaRetained, "306.25");
        assert.equal("passwordHash" in body.items[0].policy, false);
        assert.equal("balanceDueFromInsured" in body.items[0].policy, false);
        assert.equal("remainingNetDue" in body.items[0].policy, false);

        const pending = await request(running.baseUrl, {
          cookie: adminCookie,
          path: `${POLICY_LEDGER_LIST_PATH}?month=2026-07&finance=ipfs_pending`,
        });
        assert.equal((pending.body as any).items.length, 1);
        assert.equal(
          (pending.body as any).items[0].policy.id,
          pendingFinance.id,
        );
        const duplicates = await request(running.baseUrl, {
          cookie: adminCookie,
          path: `${POLICY_LEDGER_LIST_PATH}?month=2026-07&duplicates=only`,
        });
        assert.equal((duplicates.body as any).items.length, 2);

        const detail = await request(running.baseUrl, {
          cookie: adminCookie,
          path: `/api/policies/${completedFinance.id}`,
        });
        assert.equal(detail.statusCode, 200);
        assert.equal((detail.body as any).item.policy.mgaPaid, true);
        assert.equal(
          (detail.body as any).item.labels.producerDisplayName.startsWith(
            "Policy Producer",
          ),
          true,
        );

        for (const cookie of [employeeCookie, producerCookie]) {
          for (const path of [
            `${POLICY_LEDGER_LIST_PATH}?month=2026-07`,
            `/api/policies/${pendingFinance.id}`,
          ]) {
            const denied = await request(running.baseUrl, { cookie, path });
            assert.equal(denied.statusCode, 403);
            assert.deepEqual(denied.body, {
              error: { code: "forbidden", message: "Forbidden" },
            });
            const serialized = JSON.stringify(denied.body);
            assert.equal(serialized.includes("Acme Construction"), false);
            assert.equal(serialized.includes("basePremium"), false);
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
