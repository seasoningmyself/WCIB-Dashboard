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
import {
  ADMIN_STAFF_DEACTIVATE_PATH,
  ADMIN_STAFF_DETAIL_PATH,
  ADMIN_STAFF_PATH,
  ADMIN_STAFF_RATE_PATH,
  ADMIN_STAFF_RATES_PATH,
  ADMIN_STAFF_REACTIVATE_PATH,
  ADMIN_STAFF_TEMPORARY_PASSWORD_PATH,
  registerAdminStaffRoutes,
} from "./admin-staff.js";
import type { RouteAccessDeclaration, RouteRegistrar } from "./routes.js";

const logger: AppLogger = { error() {}, info() {}, warn() {} };

test("admin staff routes are explicitly admin-only and have no delete path", async () => {
  let called = 0;
  const registrations: Array<{
    access: RouteAccessDeclaration;
    handler: RequestHandler;
    method: string;
    path: string;
  }> = [];
  const authorization = createAuthorizationGuards({
    async findUser() {
      return null;
    },
    async loadPrincipal() {
      return null;
    },
    logger,
  });
  let requirement: unknown;
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
  registerAdminStaffRoutes(routes, {
    authorization: observedAuthorization,
    create: fail,
    createRate: fail,
    get: fail,
    issueTemporaryPassword: fail,
    list: fail,
    logger,
    setActive: fail,
    update: fail,
    updateRate: fail,
  });

  assert.deepEqual(requirement, { capabilities: ["admin"] });
  assert.deepEqual(
    registrations.map(({ method, path }) => `${method} ${path}`),
    [
      `GET ${ADMIN_STAFF_PATH}`,
      `GET ${ADMIN_STAFF_DETAIL_PATH}`,
      `POST ${ADMIN_STAFF_PATH}`,
      `PATCH ${ADMIN_STAFF_DETAIL_PATH}`,
      `POST ${ADMIN_STAFF_DEACTIVATE_PATH}`,
      `POST ${ADMIN_STAFF_REACTIVATE_PATH}`,
      `POST ${ADMIN_STAFF_RATES_PATH}`,
      `PATCH ${ADMIN_STAFF_RATE_PATH}`,
      `POST ${ADMIN_STAFF_TEMPORARY_PASSWORD_PATH}`,
    ],
  );
  assert.equal(registrations.some(({ method }) => method === "DELETE"), false);
  for (const registration of registrations) {
    assert.equal(typeof registration.access.authorization, "function");
    assert.equal("public" in registration.access, false);
    const error = await invokeWithoutContext(registration.handler);
    assert.equal(error?.name, "MissingAuthorizationContextError");
  }
  assert.equal(called, 0);
});

async function invokeWithoutContext(
  handler: RequestHandler,
): Promise<Error | undefined> {
  const req = {
    body: {},
    params: { rateId: randomUUID(), userId: randomUUID() },
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
