import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Express } from "express";
import { test } from "node:test";
import type { CreateDraftRequest } from "../../shared/drafts.js";
import { createApp } from "../app.js";
import {
  createDatabaseAuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import { createSessionMiddleware } from "../auth/sessions.js";
import { createUser } from "../auth/users.js";
import { listMyCommissionSources } from "../commissions/read.js";
import { createDatabasePool } from "../db/client.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  createPolicyReferenceFixture,
  policyTestInput,
  type PolicyReferenceFixture,
} from "../db/policy-test-fixture.js";
import {
  paySheets,
  policies,
  producerRateHistory,
  staffProfiles,
  userCapabilities,
  users,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { createOwnDraft } from "../drafts/create.js";
import { submitOwnDraft } from "../drafts/submit.js";
import { StructuredLogger } from "../logging/logger.js";
import { closePaySheet } from "../pay-sheets/close.js";
import { syncMgaPaymentSheetPlacement } from "../pay-sheets/mga-placement.js";
import { setMgaPaymentState } from "../policies/mga-payments.js";
import { LOGIN_PATH, registerAuthRoutes } from "./auth.js";
import {
  MY_COMMISSIONS_PATH,
  registerMyCommissionsRoute,
} from "./my-commissions.js";
import { auditRouteAccessDeclarations } from "./routes.js";

const PASSWORD = "StrongPass123!";
const SESSION_SECRET =
  "my-commissions-db-test-secret-at-least-32-characters";
const AS_OF = new Date("2026-07-11T12:00:00.000Z");

const PROHIBITED_FIELDS = [
  "policyNumber",
  "effectiveDate",
  "expirationDate",
  "carrierId",
  "carrierName",
  "mgaId",
  "mgaName",
  "contact",
  "contacts",
  "basePremium",
  "taxes",
  "mgaFee",
  "brokerFee",
  "commissionAmount",
  "commissionRate",
  "commissionMode",
  "amountPaid",
  "proposalTotal",
  "netDue",
  "paymentMode",
  "depositOption",
  "financeBalance",
  "financeReference",
  "financeContact",
  "financeMeta",
  "ipfsFinanced",
  "ipfsManual",
  "ipfsReturning",
  "ipfsPushed",
  "ipfsPushedAt",
  "agencyRevenue",
  "agencyTotal",
  "agencyTotals",
  "sophiaShare",
  "sophiaTakeHome",
  "rate",
  "rateHistory",
  "rateSnapshot",
  "frozenRateSnapshot",
  "producerUserId",
  "producerDisplayName",
] as const;

interface TestResponse {
  body: unknown;
  headers: Headers;
  statusCode: number;
}

test("My Commissions is producer-owned, frozen for closed items, and exact-field projected", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for My Commissions test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_stone121_comm",
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
        const fixtureEmailById = new Map(
          fixtureAccounts.map((account) => [account.id, account.email]),
        );
        const producerEmail = fixtureEmailById.get(references.producerUserId);
        const employeeEmail = fixtureEmailById.get(references.submittedByUserId);
        assert.ok(producerEmail && employeeEmail);

        const admin = await createUser(database, {
          email: `stone121-admin-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        const otherProducer = await createUser(database, {
          email: `stone121-other-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        const producerWithoutRate = await createUser(database, {
          email: `stone121-no-rate-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        await database.insert(staffProfiles).values([
          {
            displayName: "Other Producer",
            role: "producer",
            userId: otherProducer.id,
          },
          {
            displayName: "Producer Without Rate",
            role: "producer",
            userId: producerWithoutRate.id,
          },
        ]);
        const adminContext = context(admin.id, null, ["admin"]);
        const producerContext = context(
          references.producerUserId,
          "producer",
        );
        const otherProducerContext = context(otherProducer.id, "producer");

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

        const [closedPolicy] = await database
          .insert(policies)
          .values(
            approvedPolicy(references, {
              brokerFee: "10.00",
              commissionAmount: "200.00",
              commissionRate: "20.0000",
              insuredName: "Frozen Own Insured",
              netDue: "790.00",
              policyNumber: "STONE-121-FROZEN",
              producerUserId: references.producerUserId,
              proposalTotal: "1010.00",
            }),
          )
          .returning();
        assert.ok(closedPolicy);
        const sheets = await database
          .insert(paySheets)
          .values([
            {
              createdAt: new Date("2026-07-01T00:00:00.000Z"),
              openedAt: new Date("2026-07-01T00:00:00.000Z"),
              ownerType: "sophia",
              ownerUserId: admin.id,
              periodMonth: 6,
              periodYear: 2026,
              updatedAt: new Date("2026-07-01T00:00:00.000Z"),
            },
            {
              createdAt: new Date("2026-07-01T00:00:00.000Z"),
              openedAt: new Date("2026-07-01T00:00:00.000Z"),
              ownerType: "producer",
              ownerUserId: references.producerUserId,
              periodMonth: 6,
              periodYear: 2026,
              updatedAt: new Date("2026-07-01T00:00:00.000Z"),
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

        await database.insert(producerRateHistory).values({
          effectiveDate: "2026-07-01",
          newBrokerRate: "20.00",
          newCommissionRate: "40.00",
          producerUserId: references.producerUserId,
          renewalBrokerRate: "15.00",
          renewalCommissionRate: "30.00",
        });

        const insertedPolicies = await database
          .insert(policies)
          .values([
            approvedPolicy(references, {
              brokerFee: "10.00",
              commissionAmount: "200.00",
              commissionRate: "20.0000",
              insuredName: "Open Own Insured",
              netDue: "790.00",
              policyNumber: "STONE-121-OPEN",
              producerUserId: references.producerUserId,
              proposalTotal: "1010.00",
            }),
            approvedPolicy(references, {
              brokerFee: "0.00",
              commissionAmount: "100.00",
              insuredName: "Recent Paid Own Insured",
              policyNumber: "STONE-121-RECENT",
              producerCommissionReceivedAt: new Date(
                "2026-07-01T12:00:00.000Z",
              ),
              producerUserId: references.producerUserId,
            }),
            approvedPolicy(references, {
              brokerFee: "0.00",
              commissionAmount: "100.00",
              insuredName: "Expired Paid Own Insured",
              policyNumber: "STONE-121-EXPIRED",
              producerCommissionReceivedAt: new Date(
                "2026-06-10T11:59:59.000Z",
              ),
              producerUserId: references.producerUserId,
            }),
            approvedPolicy(references, {
              insuredName: "Other Producer Secret",
              policyNumber: "STONE-121-OTHER",
              producerUserId: otherProducer.id,
            }),
            approvedPolicy(references, {
              insuredName: "No Rate Own Insured",
              policyNumber: "STONE-121-NO-RATE",
              producerUserId: producerWithoutRate.id,
            }),
            approvedPolicy(references, {
              insuredName: "Agency Only Secret",
              kayleeSplit: "none",
              policyNumber: "STONE-121-AGENCY",
              producerUserId: null,
            }),
          ])
          .returning({ id: policies.id, insuredName: policies.insuredName });
        assert.equal(insertedPolicies.length, 6);

        const ownReview = await createOwnDraft(
          database,
          producerContext,
          reviewInput(references, references.producerUserId, "Own In Review"),
          new Date("2026-07-10T08:00:00.000Z"),
        );
        await submitOwnDraft(
          database,
          producerContext,
          ownReview.id,
          new Date("2026-07-10T09:00:00.000Z"),
        );
        const otherReview = await createOwnDraft(
          database,
          otherProducerContext,
          reviewInput(references, otherProducer.id, "Other Review Secret"),
          new Date("2026-07-10T10:00:00.000Z"),
        );
        await submitOwnDraft(
          database,
          otherProducerContext,
          otherReview.id,
          new Date("2026-07-10T11:00:00.000Z"),
        );

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
                  AS_OF,
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
        const route = auditRouteAccessDeclarations(app).find(
          (candidate) =>
            candidate.method === "GET" &&
            candidate.path === MY_COMMISSIONS_PATH,
        );
        assert.deepEqual(route?.access, { type: "authorized" });
        const running = await startServer(app);
        server = running.server;

        const producerCookie = await login(running.baseUrl, producerEmail);
        const otherProducerCookie = await login(
          running.baseUrl,
          otherProducer.email,
        );
        const noRateCookie = await login(
          running.baseUrl,
          producerWithoutRate.email,
        );
        const employeeCookie = await login(running.baseUrl, employeeEmail);
        const adminCookie = await login(running.baseUrl, admin.email);

        const own = await request(running.baseUrl, {
          cookie: producerCookie,
          path: MY_COMMISSIONS_PATH,
        });
        assert.equal(own.statusCode, 200);
        assert.equal(own.headers.get("cache-control"), "no-store");
        const ownBody = own.body as any;
        assert.deepEqual(ownBody.summary, {
          inReviewCount: 1,
          owedAmount: "137.00",
          owedCount: 2,
          paidLast30DaysAmount: "40.00",
          paidLast30DaysCount: 1,
        });
        assert.deepEqual(
          ownBody.items.map((item: any) => [
            item.insuredName,
            item.payout,
            item.section,
            item.estimate,
          ]),
          [
            ["Frozen Own Insured", "55.00", "owed", false],
            ["Open Own Insured", "82.00", "owed", false],
            ["Own In Review", "50.00", "in_review", true],
            ["Recent Paid Own Insured", "40.00", "paid", false],
          ],
        );
        assertExactProducerProjection(ownBody);
        const ownSerialized = JSON.stringify(ownBody);
        for (const secret of [
          "Expired Paid Own Insured",
          "Other Producer Secret",
          "Other Review Secret",
          "Agency Only Secret",
        ]) {
          assert.equal(ownSerialized.includes(secret), false, secret);
        }

        const other = await request(running.baseUrl, {
          cookie: otherProducerCookie,
          path: MY_COMMISSIONS_PATH,
        });
        assert.equal(other.statusCode, 200);
        assert.equal(JSON.stringify(other.body).includes("Other Producer Secret"), true);
        assert.equal(JSON.stringify(other.body).includes("Frozen Own Insured"), false);
        assert.equal(JSON.stringify(other.body).includes("Own In Review"), false);
        assertExactProducerProjection(other.body);

        const searchGuess = await request(running.baseUrl, {
          cookie: producerCookie,
          path: `${MY_COMMISSIONS_PATH}?search=${encodeURIComponent(
            "Other Producer Secret",
          )}`,
        });
        assert.equal(searchGuess.statusCode, 200);
        assert.deepEqual((searchGuess.body as any).items, []);
        assert.deepEqual((searchGuess.body as any).summary, ownBody.summary);

        const guessedSelector = await request(running.baseUrl, {
          cookie: producerCookie,
          path: `${MY_COMMISSIONS_PATH}?producerUserId=${otherProducer.id}`,
        });
        assert.equal(guessedSelector.statusCode, 400);
        assert.equal(JSON.stringify(guessedSelector.body).includes("Other Producer Secret"), false);

        const sorted = await request(running.baseUrl, {
          cookie: producerCookie,
          path: `${MY_COMMISSIONS_PATH}?sort=account`,
        });
        assert.equal(sorted.statusCode, 200);
        assert.equal(JSON.stringify(sorted.body).includes("Other Producer Secret"), false);
        assertExactProducerProjection(sorted.body);

        const noRate = await request(running.baseUrl, {
          cookie: noRateCookie,
          path: MY_COMMISSIONS_PATH,
        });
        assert.equal(noRate.statusCode, 200);
        assert.equal((noRate.body as any).items[0].payout, null);
        assert.equal((noRate.body as any).summary.owedAmount, null);

        for (const denied of [
          { cookie: undefined, status: 401 },
          { cookie: employeeCookie, status: 403 },
          { cookie: adminCookie, status: 403 },
        ]) {
          const response = await request(running.baseUrl, {
            cookie: denied.cookie,
            path: MY_COMMISSIONS_PATH,
          });
          assert.equal(response.statusCode, denied.status);
          const serialized = JSON.stringify(response.body);
          assert.equal(serialized.includes("Frozen Own Insured"), false);
          assert.equal(serialized.includes("payout"), false);
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
    policyNumber: `STONE-121-${randomUUID()}`,
    producerUserId: references.producerUserId,
    proposalTotal: "1000.00",
    sourceDraftId: null,
    ...overrides,
  });
}

function reviewInput(
  references: PolicyReferenceFixture,
  producerUserId: string,
  insuredName: string,
): CreateDraftRequest {
  return {
    accountAssignment: "book",
    amountPaid: "1000.00",
    basePremium: "1000.00",
    brokerFee: "50.00",
    carrierId: references.carrierId,
    commissionConfirmed: true,
    commissionMode: "pct",
    commissionRate: "10.0000",
    effectiveDate: "2026-07-10",
    expirationDate: "2027-07-10",
    insuredName,
    mgaFee: "0.00",
    mgaId: references.mgaId,
    officeLocationId: references.officeLocationId,
    paymentMode: "full",
    policyNumber: `STONE-121-REVIEW-${randomUUID()}`,
    policyTypeId: references.policyTypeId,
    producerUserId,
    proposalTotal: "1050.00",
    taxes: "0.00",
    transactionType: "New",
  };
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

function assertExactProducerProjection(body: unknown): void {
  const parsed = body as { items?: unknown[] };
  assert.ok(Array.isArray(parsed.items));
  for (const item of parsed.items as Array<Record<string, unknown>>) {
    assert.deepEqual(Object.keys(item), [
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
    for (const field of PROHIBITED_FIELDS) {
      assert.equal(field in item, false, field);
    }
  }
  const serialized = JSON.stringify(body);
  for (const field of PROHIBITED_FIELDS) {
    assert.equal(serialized.includes(`\"${field}\"`), false, field);
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
