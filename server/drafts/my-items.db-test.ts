import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
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
import { createDatabasePool } from "../db/client.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import { mgas, staffProfiles, userCapabilities } from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { LOGIN_PATH, registerAuthRoutes } from "../http/auth.js";
import { MY_ITEMS_PATH, registerMyItemsRoute } from "../http/my-items.js";
import { auditRouteAccessDeclarations } from "../http/routes.js";
import { StructuredLogger } from "../logging/logger.js";
import { flagDraftForHelp } from "../policies/lifecycle.js";
import { createOwnDraft } from "./create.js";
import { listOwnMyItemSources } from "./my-items.js";

const PASSWORD = "StrongPass123!";
const SESSION_SECRET = "my-items-test-secret-at-least-32-characters";

const PROHIBITED_FIELDS = [
  "ownerUserId",
  "policyTypeId",
  "transactionType",
  "effectiveDate",
  "expirationDate",
  "carrierId",
  "mgaId",
  "producerUserId",
  "basePremium",
  "taxes",
  "mgaFee",
  "brokerFee",
  "commissionMode",
  "commissionRate",
  "commissionAmount",
  "agencyCommissionAmount",
  "producerPayout",
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
  "linkedPolicyId",
  "linkedQueueEntryId",
  "history",
] as const;

test("My Items is UUID-owned, blank-safe, role-guarded, and exact-field projected", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for My Items test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_stone124_items",
    async (isolatedUrl) => {
      const pool = createDatabasePool(isolatedUrl);
      const database = drizzle(pool, { schema: databaseSchema });
      const logger = new StructuredLogger({ write() {} });
      let server: Server | null = null;
      try {
        const employee = await createUser(database, {
          displayName: "Employee Owner",
          email: `stone124-employee-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        const producer = await createUser(database, {
          displayName: "Producer Owner",
          email: `stone124-producer-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        const admin = await createUser(database, {
          email: `stone124-admin-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        await database.insert(staffProfiles).values([
          { role: "employee", userId: employee.id },
          { role: "producer", userId: producer.id },
        ]);
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const [mga] = await database
          .insert(mgas)
          .values({ name: "P2 Test MGA" })
          .returning({ id: mgas.id });
        assert.ok(mga);

        const employeeContext = context(employee.id, "employee");
        const producerContext = context(producer.id, "producer");
        await createOwnDraft(
          database,
          employeeContext,
          {},
          new Date("2026-07-11T10:00:00.000Z"),
        );
        const employeeDraft = await createOwnDraft(
          database,
          employeeContext,
          {
            basePremium: "1000.00",
            financeReference: "PRIVATE-FINANCE",
            insuredName: "Employee Own Item",
            mgaId: mga.id,
            policyNumber: "P2-1001",
          },
          new Date("2026-07-11T11:00:00.000Z"),
        );
        const flagged = await createOwnDraft(
          database,
          employeeContext,
          { insuredName: "Employee Help Item" },
          new Date("2026-07-11T12:00:00.000Z"),
        );
        await flagDraftForHelp(
          database,
          employeeContext,
          flagged.id,
          "Please confirm the account assignment",
          new Date("2026-07-11T13:00:00.000Z"),
        );
        await createOwnDraft(
          database,
          producerContext,
          {
            basePremium: "9000.00",
            insuredName: "Other Producer Secret",
          },
          new Date("2026-07-11T14:00:00.000Z"),
        );

        const authorization = createDatabaseAuthorizationGuards(
          database,
          logger,
        );
        const app = createApp({
          logger,
          registerRoutes(routes) {
            registerAuthRoutes(routes, { database, logger });
            registerMyItemsRoute(routes, {
              authorization,
              list: (requestContext) =>
                listOwnMyItemSources(database, requestContext),
              logger,
            });
          },
          sessionMiddleware: createSessionMiddleware(pool, {
            logger,
            nodeEnv: "development",
            secret: SESSION_SECRET,
          }),
        });
        const declaration = auditRouteAccessDeclarations(app).find(
          ({ method, path }) => method === "GET" && path === MY_ITEMS_PATH,
        );
        assert.deepEqual(declaration?.access, { type: "authorized" });

        const running = await startServer(app);
        server = running.server;
        const employeeCookie = await login(
          running.baseUrl,
          employee.email,
        );
        const producerCookie = await login(
          running.baseUrl,
          producer.email,
        );
        const adminCookie = await login(running.baseUrl, admin.email);

        const employeeResponse = await request(running.baseUrl, {
          cookie: employeeCookie,
          path: MY_ITEMS_PATH,
        });
        assert.equal(employeeResponse.statusCode, 200);
        assert.equal(employeeResponse.headers.get("cache-control"), "no-store");
        const employeeItems = (employeeResponse.body as any).items;
        assert.deepEqual(
          employeeItems.map((item: any) => item.id),
          [flagged.id, employeeDraft.id],
        );
        assert.equal(
          JSON.stringify(employeeResponse.body).includes("Other Producer Secret"),
          false,
        );
        assert.deepEqual(
          employeeItems.find((item: any) => item.id === employeeDraft.id),
          {
            id: employeeDraft.id,
            lastActivityAt: "2026-07-11T11:00:00.000Z",
            mgaName: "P2 Test MGA",
            policyNumber: "P2-1001",
            reason: null,
            status: "draft",
            submittedAt: null,
            title: "Employee Own Item",
          },
        );
        assertExactStatusProjection(employeeResponse.body);

        const producerResponse = await request(running.baseUrl, {
          cookie: producerCookie,
          path: MY_ITEMS_PATH,
        });
        assert.equal(producerResponse.statusCode, 200);
        assert.equal(
          JSON.stringify(producerResponse.body).includes("Other Producer Secret"),
          true,
        );
        assert.equal(
          JSON.stringify(producerResponse.body).includes("Employee Own Item"),
          false,
        );
        assertExactStatusProjection(producerResponse.body);

        const guessedOwner = await request(running.baseUrl, {
          cookie: employeeCookie,
          path: `${MY_ITEMS_PATH}?ownerUserId=${producer.id}`,
        });
        assert.equal(guessedOwner.statusCode, 400);
        assert.equal(
          JSON.stringify(guessedOwner.body).includes("Other Producer Secret"),
          false,
        );

        for (const denied of [
          { cookie: undefined, status: 401 },
          { cookie: adminCookie, status: 403 },
        ]) {
          const response = await request(running.baseUrl, {
            cookie: denied.cookie,
            path: MY_ITEMS_PATH,
          });
          assert.equal(response.statusCode, denied.status);
          assert.equal(JSON.stringify(response.body).includes("items"), false);
        }
      } finally {
        if (server !== null) await closeServer(server);
        await pool.end();
      }
    },
  );
});

function context(
  userId: string,
  staffRole: "employee" | "producer",
): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: [],
      staffRole,
      userActive: true,
      userId,
    },
  };
}

function assertExactStatusProjection(body: unknown): void {
  const items = (body as { items?: Array<Record<string, unknown>> }).items;
  assert.ok(Array.isArray(items));
  for (const item of items) {
    assert.deepEqual(Object.keys(item), [
      "id",
      "lastActivityAt",
      "mgaName",
      "policyNumber",
      "reason",
      "status",
      "submittedAt",
      "title",
    ]);
    for (const field of PROHIBITED_FIELDS) {
      assert.equal(field in item, false, field);
    }
  }
  const serialized = JSON.stringify(body);
  for (const field of PROHIBITED_FIELDS) {
    assert.equal(serialized.includes(`"${field}"`), false, field);
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
): Promise<{ body: unknown; headers: Headers; statusCode: number }> {
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
