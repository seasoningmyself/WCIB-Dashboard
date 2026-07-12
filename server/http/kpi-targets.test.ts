import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import { createAuthorizationGuards } from "../auth/authorization.js";
import type { KpiTargetRecord } from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import {
  KPI_TARGET_PATH,
  KPI_TARGETS_PATH,
  registerKpiTargetRoutes,
} from "./kpi-targets.js";
import type { RouteAccessDeclaration, RouteRegistrar } from "./routes.js";

const logger: AppLogger = { error() {}, info() {}, warn() {} };

test("KPI target routes are explicitly admin-only and fail closed without context", async () => {
  let called = 0;
  let requirement: unknown;
  const registrations: Array<{
    access: RouteAccessDeclaration;
    handler: RequestHandler;
    method: string;
    path: string;
  }> = [];
  const authorization = createAuthorizationGuards({
    async findUser() { return null; },
    async loadPrincipal() { return null; },
    logger,
  });
  const observedAuthorization = {
    require(value: unknown) {
      requirement = value;
      return authorization.require(value as never);
    },
  };
  const routes = Object.fromEntries(
    ["delete", "get", "head", "options", "patch", "post", "put"].map(
      (method) => [
        method,
        (
          path: string,
          access: RouteAccessDeclaration,
          ...handlers: RequestHandler[]
        ) => {
          assert.ok(handlers[0]);
          registrations.push({
            access,
            handler: handlers[0],
            method: method.toUpperCase(),
            path,
          });
        },
      ],
    ),
  ) as unknown as RouteRegistrar;
  const fail = async () => {
    called += 1;
    throw new Error("must not run");
  };

  registerKpiTargetRoutes(routes, {
    authorization: observedAuthorization,
    list: fail,
    logger,
    upsert: fail,
  });

  assert.deepEqual(requirement, { capabilities: ["admin"] });
  assert.deepEqual(
    registrations.map(({ method, path }) => `${method} ${path}`),
    [`GET ${KPI_TARGETS_PATH}`, `PUT ${KPI_TARGET_PATH}`],
  );
  for (const registration of registrations) {
    assert.equal(typeof registration.access.authorization, "function");
    assert.equal("public" in registration.access, false);
    const error = await invokeWithoutContext(registration.handler);
    assert.equal(error?.name, "MissingAuthorizationContextError");
  }
  assert.equal(called, 0);
});

test("KPI target routes expose no delete or unguarded mutation path", () => {
  const methods: string[] = [];
  const routes = Object.fromEntries(
    ["delete", "get", "head", "options", "patch", "post", "put"].map(
      (method) => [
        method,
        () => methods.push(method),
      ],
    ),
  ) as unknown as RouteRegistrar;
  const authorization = createAuthorizationGuards({
    async findUser() { return null; },
    async loadPrincipal() { return null; },
    logger,
  });
  const target: KpiTargetRecord = {
    createdAt: new Date(),
    id: "00000000-0000-4000-8000-000000000001",
    newPolicyCountTarget: null,
    newRevenueTarget: null,
    producerUserId: null,
    retentionRateTarget: null,
    scopeType: "company",
    updatedAt: new Date(),
    year: 2026,
  };
  registerKpiTargetRoutes(routes, {
    authorization,
    async list() { return { items: [target], producers: [], year: 2026 }; },
    logger,
    async upsert() { return { target }; },
  });
  assert.deepEqual(methods, ["get", "put"]);
});

async function invokeWithoutContext(
  handler: RequestHandler,
): Promise<Error | undefined> {
  const req = {
    body: { newPolicyCountTarget: 10, producerUserId: null },
    params: { scopeType: "company", year: "2026" },
    query: { year: "2026" },
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
