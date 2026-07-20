import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Express } from "express";
import { test } from "node:test";
import { adminOfficeManagementResponseSchema } from "../../shared/admin-office-locations.js";
import { activeVocabularyResponseSchema } from "../../shared/vocabulary.js";
import { createApp } from "../app.js";
import { createDatabaseAuthorizationGuards } from "../auth/authorization.js";
import { createSessionMiddleware } from "../auth/sessions.js";
import { createUser } from "../auth/users.js";
import { createDatabasePool } from "../db/client.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  drafts,
  officeLocations,
  staffProfiles,
  userCapabilities,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import { StructuredLogger } from "../logging/logger.js";
import {
  createAdminOfficeLocation,
  loadAdminOfficeManagementSource,
  renameAdminOfficeLocation,
  setAdminOfficeLocationActive,
} from "../offices/admin.js";
import { loadActiveVocabulary } from "../vocabulary/active.js";
import {
  ADMIN_OFFICE_LOCATION_DEACTIVATE_PATH,
  ADMIN_OFFICE_LOCATION_PATH,
  ADMIN_OFFICE_LOCATION_REACTIVATE_PATH,
  ADMIN_OFFICE_LOCATIONS_PATH,
  registerAdminOfficeRoutes,
} from "./admin-office-locations.js";
import { LOGIN_PATH, registerAuthRoutes } from "./auth.js";
import { auditRouteAccessDeclarations } from "./routes.js";
import {
  ACTIVE_VOCABULARY_PATH,
  registerActiveVocabularyRoute,
} from "./vocabulary.js";

const PASSWORD = "StrongPass123!";
const SESSION_SECRET = "admin-office-db-test-secret-at-least-32-characters";

interface TestResponse {
  body: unknown;
  headers: Headers;
  statusCode: number;
}

test("office management preserves history and canonical form mode", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for admin office test");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_stone129_offices",
    async (isolatedUrl) => {
      const pool = createDatabasePool(isolatedUrl);
      const database = drizzle(pool, { schema: databaseSchema });
      const logLines: string[] = [];
      const logger = new StructuredLogger({
        write(chunk) { logLines.push(String(chunk)); },
      });
      let server: Server | null = null;
      try {
        const admin = await createUser(database, {
          email: `stone129-admin-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: admin.id,
        });
        const employee = await createUser(database, {
          displayName: `STONE 129 Employee ${randomUUID()}`,
          email: `stone129-employee-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        const producer = await createUser(database, {
          displayName: `STONE 129 Producer ${randomUUID()}`,
          email: `stone129-producer-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        await database.insert(staffProfiles).values([
          { role: "employee", userId: employee.id },
          { role: "producer", userId: producer.id },
        ]);
        const initialOfficeName = `STONE 129 Historical ${randomUUID()}`;
        const [initialOffice] = await database
          .insert(officeLocations)
          .values({ name: initialOfficeName })
          .returning({ id: officeLocations.id });
        assert.ok(initialOffice);
        const [referencingDraft] = await database
          .insert(drafts)
          .values({
            officeLocationId: initialOffice.id,
            ownerUserId: employee.id,
          })
          .returning({ id: drafts.id });
        assert.ok(referencingDraft);

        const authorization = createDatabaseAuthorizationGuards(database, logger);
        const app = createApp({
          logger,
          registerRoutes(routes) {
            registerAuthRoutes(routes, { database, logger });
            registerActiveVocabularyRoute(routes, {
              authorization,
              load: () => loadActiveVocabulary(database),
              logger,
            });
            registerAdminOfficeRoutes(routes, {
              authorization,
              create: (context, input) =>
                createAdminOfficeLocation(database, context, input, logger),
              list: (context) =>
                loadAdminOfficeManagementSource(database, context),
              logger,
              rename: (context, officeLocationId, input) =>
                renameAdminOfficeLocation(
                  database,
                  context,
                  officeLocationId,
                  input,
                  logger,
                ),
              setActive: (context, officeLocationId, active) =>
                setAdminOfficeLocationActive(
                  database,
                  context,
                  officeLocationId,
                  active,
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
        const officeRoutes = auditRouteAccessDeclarations(app).filter(({ path }) =>
          path.startsWith(ADMIN_OFFICE_LOCATIONS_PATH),
        );
        assert.equal(officeRoutes.length, 5);
        assert.equal(
          officeRoutes.every(({ access }) => access.type === "authorized"),
          true,
        );
        assert.equal(officeRoutes.some(({ method }) => method === "DELETE"), false);

        const running = await startServer(app);
        server = running.server;
        const adminCookie = await login(running.baseUrl, admin.email);
        const employeeCookie = await login(running.baseUrl, employee.email);
        const producerCookie = await login(running.baseUrl, producer.email);
        await assertWrongRolesDenied(
          running.baseUrl,
          employeeCookie,
          producerCookie,
          initialOffice.id,
        );

        const initial = await request(running.baseUrl, {
          cookie: adminCookie,
          path: ADMIN_OFFICE_LOCATIONS_PATH,
        });
        assert.equal(initial.statusCode, 200);
        assert.match(initial.headers.get("cache-control") ?? "", /no-store/);
        const initialState = adminOfficeManagementResponseSchema.parse(initial.body);
        assert.deepEqual(initialState.mode, {
          activeCount: 1,
          kind: "single",
          soleOfficeId: initialOffice.id,
        });
        assert.deepEqual(Object.keys(initialState.items[0] ?? {}).sort(), [
          "createdAt",
          "id",
          "isActive",
          "name",
          "updatedAt",
        ]);

        const secondName = `STONE 129 West ${randomUUID()}`;
        const second = await request(running.baseUrl, {
          body: { name: `  ${secondName}  ` },
          cookie: adminCookie,
          method: "POST",
          path: ADMIN_OFFICE_LOCATIONS_PATH,
        });
        assert.equal(second.statusCode, 201);
        const secondState = adminOfficeManagementResponseSchema.parse(second.body);
        assert.equal(secondState.mode.kind, "multiple");
        assert.equal(secondState.mode.activeCount, 2);
        const secondOffice = secondState.items.find(({ name }) => name === secondName);
        assert.ok(secondOffice);

        const concurrentName = `STONE 129 Concurrent ${randomUUID()}`;
        const concurrent = await Promise.all([
          request(running.baseUrl, {
            body: { name: concurrentName },
            cookie: adminCookie,
            method: "POST",
            path: ADMIN_OFFICE_LOCATIONS_PATH,
          }),
          request(running.baseUrl, {
            body: { name: concurrentName.toUpperCase() },
            cookie: adminCookie,
            method: "POST",
            path: ADMIN_OFFICE_LOCATIONS_PATH,
          }),
        ]);
        assert.deepEqual(
          concurrent.map(({ statusCode }) => statusCode).sort(),
          [201, 409],
        );
        const [duplicateCount] = await database
          .select({ count: sql<number>`count(*)::int` })
          .from(officeLocations)
          .where(sql`lower(${officeLocations.name}) = lower(${concurrentName})`);
        assert.equal(duplicateCount?.count, 1);
        const concurrentState = adminOfficeManagementResponseSchema.parse(
          concurrent.find(({ statusCode }) => statusCode === 201)?.body,
        );
        const concurrentOffice = concurrentState.items.find(
          ({ name }) => name.toLowerCase() === concurrentName.toLowerCase(),
        );
        assert.ok(concurrentOffice);

        const renamedName = `STONE 129 Renamed ${randomUUID()}`;
        const renamed = await request(running.baseUrl, {
          body: { name: renamedName },
          cookie: adminCookie,
          method: "PATCH",
          path: ADMIN_OFFICE_LOCATION_PATH.replace(
            ":officeLocationId",
            secondOffice.id,
          ),
        });
        assert.equal(renamed.statusCode, 200);
        assert.ok(
          adminOfficeManagementResponseSchema
            .parse(renamed.body)
            .items.some(({ id, name }) => id === secondOffice.id && name === renamedName),
        );
        const duplicateRename = await request(running.baseUrl, {
          body: { name: initialOfficeName.toUpperCase() },
          cookie: adminCookie,
          method: "PATCH",
          path: ADMIN_OFFICE_LOCATION_PATH.replace(
            ":officeLocationId",
            secondOffice.id,
          ),
        });
        assert.equal(duplicateRename.statusCode, 409);

        await changeActive(
          running.baseUrl,
          adminCookie,
          concurrentOffice.id,
          false,
          "multiple",
        );
        await changeActive(
          running.baseUrl,
          adminCookie,
          secondOffice.id,
          false,
          "single",
        );
        const zero = await changeActive(
          running.baseUrl,
          adminCookie,
          initialOffice.id,
          false,
          "unconfigured",
        );
        assert.deepEqual(zero.mode, {
          activeCount: 0,
          kind: "unconfigured",
          soleOfficeId: null,
        });
        const [preservedDraft] = await database
          .select({ officeLocationId: drafts.officeLocationId })
          .from(drafts)
          .where(eq(drafts.id, referencingDraft.id));
        assert.equal(preservedDraft?.officeLocationId, initialOffice.id);
        assert.ok(
          zero.items.some(
            ({ id, isActive, name }) =>
              id === initialOffice.id && !isActive && name === initialOfficeName,
          ),
        );

        const activeAfterZero = await request(running.baseUrl, {
          cookie: employeeCookie,
          path: ACTIVE_VOCABULARY_PATH,
        });
        assert.equal(activeAfterZero.statusCode, 200);
        assert.deepEqual(
          activeVocabularyResponseSchema.parse(activeAfterZero.body).officeLocations,
          [],
        );

        const one = await changeActive(
          running.baseUrl,
          adminCookie,
          initialOffice.id,
          true,
          "single",
        );
        assert.equal(one.mode.soleOfficeId, initialOffice.id);
        const many = await changeActive(
          running.baseUrl,
          adminCookie,
          secondOffice.id,
          true,
          "multiple",
        );
        assert.equal(many.mode.activeCount, 2);
        const idempotent = await changeActive(
          running.baseUrl,
          adminCookie,
          secondOffice.id,
          true,
          "multiple",
        );
        assert.equal(idempotent.mode.activeCount, 2);

        const activeAfterMany = await request(running.baseUrl, {
          cookie: producerCookie,
          path: ACTIVE_VOCABULARY_PATH,
        });
        const activeVocabulary = activeVocabularyResponseSchema.parse(
          activeAfterMany.body,
        );
        assert.deepEqual(
          activeVocabulary.officeLocations.map(({ id }) => id).sort(),
          [initialOffice.id, secondOffice.id].sort(),
        );

        const logs = logLines.join("\n");
        for (const forbidden of [
          initialOfficeName,
          secondName,
          renamedName,
          concurrentName,
        ]) {
          assert.equal(logs.toLowerCase().includes(forbidden.toLowerCase()), false);
        }
      } finally {
        if (server !== null) await closeServer(server);
        await pool.end();
      }
    },
  );
});

async function changeActive(
  baseUrl: string,
  cookie: string,
  officeLocationId: string,
  active: boolean,
  expectedMode: "multiple" | "single" | "unconfigured",
) {
  const path = (active
    ? ADMIN_OFFICE_LOCATION_REACTIVATE_PATH
    : ADMIN_OFFICE_LOCATION_DEACTIVATE_PATH
  ).replace(":officeLocationId", officeLocationId);
  const response = await request(baseUrl, {
    body: {},
    cookie,
    method: "POST",
    path,
  });
  assert.equal(response.statusCode, 200);
  const state = adminOfficeManagementResponseSchema.parse(response.body);
  assert.equal(state.mode.kind, expectedMode);
  return state;
}

async function assertWrongRolesDenied(
  baseUrl: string,
  employeeCookie: string,
  producerCookie: string,
  officeLocationId: string,
): Promise<void> {
  const candidates = [
    { path: ADMIN_OFFICE_LOCATIONS_PATH },
    { body: { name: "Forbidden Office" }, method: "POST", path: ADMIN_OFFICE_LOCATIONS_PATH },
    {
      body: { name: "Forbidden Rename" },
      method: "PATCH",
      path: ADMIN_OFFICE_LOCATION_PATH.replace(":officeLocationId", officeLocationId),
    },
    {
      body: {},
      method: "POST",
      path: ADMIN_OFFICE_LOCATION_DEACTIVATE_PATH.replace(
        ":officeLocationId",
        officeLocationId,
      ),
    },
    {
      body: {},
      method: "POST",
      path: ADMIN_OFFICE_LOCATION_REACTIVATE_PATH.replace(
        ":officeLocationId",
        officeLocationId,
      ),
    },
  ];
  for (const identity of [
    { cookie: undefined, statusCode: 401 },
    { cookie: employeeCookie, statusCode: 403 },
    { cookie: producerCookie, statusCode: 403 },
  ]) {
    for (const candidate of candidates) {
      const response = await request(baseUrl, {
        ...candidate,
        cookie: identity.cookie,
      });
      assert.equal(response.statusCode, identity.statusCode);
      assertNoOfficePayload(response.body);
    }
  }
}

function assertNoOfficePayload(body: unknown): void {
  const serialized = JSON.stringify(body);
  for (const field of ["items", "mode", "name", "soleOfficeId"]) {
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
