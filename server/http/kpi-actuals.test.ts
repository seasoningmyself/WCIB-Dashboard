import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import { createAuthorizationGuards } from "../auth/authorization.js";
import type { AppLogger } from "../logging/logger.js";
import {
  KPI_ACTUALS_PATH,
  registerKpiActualRoute,
} from "./kpi-actuals.js";
import type { RouteAccessDeclaration, RouteRegistrar } from "./routes.js";

const logger: AppLogger = { error() {}, info() {}, warn() {} };

test("KPI actuals route is explicitly admin-only and fails closed without context", async () => {
  let called = 0;
  let requirement: unknown;
  let registration: {
    access: RouteAccessDeclaration;
    handler: RequestHandler;
    path: string;
  } | null = null;
  const authorization = createAuthorizationGuards({
    async findUser() { return null; },
    async loadPrincipal() { return null; },
    logger,
  });
  const routes = {
    get(
      path: string,
      access: RouteAccessDeclaration,
      ...handlers: RequestHandler[]
    ) {
      assert.ok(handlers[0]);
      registration = { access, handler: handlers[0], path };
    },
  } as unknown as RouteRegistrar;
  registerKpiActualRoute(routes, {
    authorization: {
      require(value: unknown) {
        requirement = value;
        return authorization.require(value as never);
      },
    },
    async list() {
      called += 1;
      throw new Error("must not run");
    },
    logger,
  });

  assert.deepEqual(requirement, { capabilities: ["admin"] });
  assert.ok(registration);
  const observed = registration as {
    access: RouteAccessDeclaration;
    handler: RequestHandler;
    path: string;
  };
  assert.equal(observed.path, KPI_ACTUALS_PATH);
  assert.equal(typeof observed.access.authorization, "function");
  assert.equal("public" in observed.access, false);
  const error = await invokeWithoutContext(observed.handler);
  assert.equal(error?.name, "MissingAuthorizationContextError");
  assert.equal(called, 0);
});

async function invokeWithoutContext(
  handler: RequestHandler,
): Promise<Error | undefined> {
  const req = {
    params: {},
    query: { period: "full", scopeType: "company", year: "2026" },
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
