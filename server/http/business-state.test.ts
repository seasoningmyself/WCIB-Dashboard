import assert from "node:assert/strict";
import { test } from "node:test";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createAuthorizationGuards } from "../auth/authorization.js";
import {
  listBusinessStateSources,
  projectAdminBusinessState,
  resetBusinessState,
  restoreBusinessState,
  type BusinessStateSource,
} from "../business-state/service.js";
import type { BusinessStateGenerationRecord } from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import {
  BUSINESS_STATE_PATH,
  BUSINESS_STATE_RESET_PATH,
  BUSINESS_STATE_RESTORE_PATH,
  registerBusinessStateRoutes,
} from "./business-state.js";
import type { RouteAccessDeclaration, RouteRegistrar } from "./routes.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const logger: AppLogger = { error() {}, info() {}, warn() {} };

test("business-state routes are explicitly admin-only and fail closed without context", async () => {
  const actual = createAuthorizationGuards({
    async findUser() { return null; },
    async loadPrincipal() { return null; },
    logger,
  });
  let requirement: unknown;
  let calls = 0;
  const registrations: Array<{
    access: RouteAccessDeclaration;
    handler: RequestHandler;
    method: string;
    path: string;
  }> = [];
  const routes = {
    get(path: string, access: RouteAccessDeclaration, ...handlers: RequestHandler[]) {
      assert.ok(handlers[0]);
      registrations.push({ access, handler: handlers[0], method: "GET", path });
    },
    post(path: string, access: RouteAccessDeclaration, ...handlers: RequestHandler[]) {
      assert.ok(handlers[0]);
      registrations.push({ access, handler: handlers[0], method: "POST", path });
    },
  } as unknown as RouteRegistrar;
  registerBusinessStateRoutes(routes, {
    authorization: {
      require(value) {
        requirement = value;
        return actual.require(value);
      },
    },
    async list() { calls += 1; throw new Error("must not run"); },
    logger,
    async reset() { calls += 1; throw new Error("must not run"); },
    async restore() { calls += 1; throw new Error("must not run"); },
  });

  assert.deepEqual(requirement, { capabilities: ["admin"] });
  assert.deepEqual(
    registrations.map(({ access, method, path }) => ({
      authorized: typeof access.authorization === "function",
      method,
      path,
      public: "public" in access,
    })),
    [
      { authorized: true, method: "GET", path: BUSINESS_STATE_PATH, public: false },
      { authorized: true, method: "POST", path: BUSINESS_STATE_RESET_PATH, public: false },
      { authorized: true, method: "POST", path: BUSINESS_STATE_RESTORE_PATH, public: false },
    ],
  );
  for (const { handler } of registrations) {
    const error = await invokeWithoutContext(handler);
    assert.equal(error?.name, "MissingAuthorizationContextError");
  }
  assert.equal(calls, 0);
});

test("business-state service denies employee and producer before database access", async () => {
  const database = new Proxy({}, {
    get() { throw new Error("database must not be reached"); },
  }) as never;
  for (const staffRole of ["employee", "producer"] as const) {
    const context = {
      principal: {
        capabilities: [],
        staffRole,
        userActive: true,
        userId: "00000000-0000-4000-8000-000000000002",
      },
    };
    await assert.rejects(listBusinessStateSources(database, context));
    await assert.rejects(
      resetBusinessState(database, context, { confirmation: "RESET" }),
    );
    await assert.rejects(
      restoreBusinessState(
        database,
        context,
        "00000000-0000-4000-8000-000000000003",
        { confirmation: "RESTORE ABCDEF123456" },
      ),
    );
  }
});

test("admin business-state projection exposes metadata and never row contents", () => {
  const unsafe = {
    ...generation(),
    databaseUrl: "must-not-leak",
    policies: [{ premiumTotal: "1000.00", insuredName: "Private" }],
  } as BusinessStateGenerationRecord;
  const source: BusinessStateSource = {
    activeGenerationId: unsafe.id,
    generations: [unsafe],
  };
  const projected = projectAdminBusinessState(source, {
    principal: {
      capabilities: ["admin"],
      staffRole: null,
      userActive: true,
      userId: ADMIN_ID,
    },
  });
  assert.ok(projected);
  assert.deepEqual(Object.keys(projected.generations[0]!).sort(), [
    "baselineChecksum", "clearKpiTargets", "code", "createdAt", "id",
    "logicalChecksum", "migrationCount", "rowCounts", "schemaFingerprint",
    "sealedAt", "status",
  ]);
  const serialized = JSON.stringify(projected);
  for (const forbidden of ["databaseUrl", "policies", "premiumTotal", "insuredName"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

function generation(): BusinessStateGenerationRecord {
  return {
    baselineChecksum: null,
    clearKpiTargets: false,
    code: "ABCDEF123456",
    createdAt: new Date("2026-07-14T12:00:00.000Z"),
    createdByUserId: ADMIN_ID,
    formatVersion: 1,
    id: "00000000-0000-4000-8000-000000000010",
    logicalChecksum: null,
    migrationCount: 48,
    rowCounts: null,
    schemaFingerprint: "6a06ce086a9beb6b68f788f18afc03712019d56f56003401a9c796fec751991a",
    sealedAt: null,
    sealedByUserId: null,
    sourceGenerationId: null,
    status: "active",
  };
}

async function invokeWithoutContext(handler: RequestHandler): Promise<Error | undefined> {
  const req = {
    body: { clearKpiTargets: false, confirmation: "RESET" },
    params: { generationId: "00000000-0000-4000-8000-000000000010" },
    query: {},
  } as unknown as Request;
  const res = { locals: {} } as Response;
  return new Promise((resolve, reject) => {
    const next: NextFunction = (error?: unknown) => {
      if (error === undefined) resolve(undefined);
      else if (error instanceof Error) resolve(error);
      else reject(error);
    };
    handler(req, res, next);
  });
}
