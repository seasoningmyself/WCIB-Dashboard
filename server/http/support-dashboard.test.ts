import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import { createAuthorizationGuards } from "../auth/authorization.js";
import type { AppLogger } from "../logging/logger.js";
import type { RouteAccessDeclaration, RouteRegistrar } from "./routes.js";
import {
  createSupportDashboardHandler,
  registerSupportDashboardRoutes,
  SUPPORT_DASHBOARD_PATH,
} from "./support-dashboard.js";

const logger: AppLogger = { error() {}, info() {}, warn() {} };

test("support dashboard route requires support_engineer exactly", async () => {
  const authorization = createAuthorizationGuards({
    async findUser() { return null; },
    async loadPrincipal() { return null; },
    logger,
  });
  let requirement: unknown;
  let registration:
    | {
        access: RouteAccessDeclaration;
        handler: RequestHandler;
        method: string;
        path: string;
      }
    | undefined;
  const routes = {
    get(
      path: string,
      access: RouteAccessDeclaration,
      handler: RequestHandler,
    ) {
      registration = { access, handler, method: "GET", path };
    },
  } as unknown as RouteRegistrar;
  let calls = 0;
  registerSupportDashboardRoutes(routes, {
    authorization: {
      require(value) {
        requirement = value;
        return authorization.require(value);
      },
    },
    async load() {
      calls += 1;
      throw new Error("must not run without trusted context");
    },
  });

  assert.deepEqual(requirement, { capabilities: ["support_engineer"] });
  assert.equal(registration?.method, "GET");
  assert.equal(registration?.path, SUPPORT_DASHBOARD_PATH);
  assert.equal("public" in (registration?.access ?? {}), false);
  const error = await invokeWithoutContext(registration?.handler);
  assert.equal(error?.name, "MissingAuthorizationContextError");
  assert.equal(calls, 0);
});

test("support dashboard handler never trusts a caller without projected context", async () => {
  let calls = 0;
  const handler = createSupportDashboardHandler({
    async load() {
      calls += 1;
      throw new Error("must not run");
    },
  });
  const error = await invokeWithoutContext(handler);
  assert.equal(error?.name, "MissingAuthorizationContextError");
  assert.equal(calls, 0);
});

async function invokeWithoutContext(
  handler: RequestHandler | undefined,
): Promise<Error | undefined> {
  assert.ok(handler);
  const req = {
    params: { userId: randomUUID() },
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
