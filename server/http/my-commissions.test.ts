import assert from "node:assert/strict";
import { test } from "node:test";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createAuthorizationGuards } from "../auth/authorization.js";
import type { AppLogger } from "../logging/logger.js";
import {
  MY_COMMISSIONS_PATH,
  createMyCommissionsListHandler,
  registerMyCommissionsRoute,
} from "./my-commissions.js";
import type { RouteAccessDeclaration, RouteRegistrar } from "./routes.js";

const logger: AppLogger = { error() {}, info() {}, warn() {} };

test("My Commissions route declares producer-only authorization", () => {
  let requirement: unknown;
  let registration:
    | { access: RouteAccessDeclaration; handler: RequestHandler; path: string }
    | undefined;
  const authorization = createAuthorizationGuards({
    async findUser() {
      return null;
    },
    async loadPrincipal() {
      return null;
    },
    logger,
  });
  const observedAuthorization = {
    require(value: unknown) {
      requirement = value;
      return authorization.require(value as never);
    },
  };
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

  registerMyCommissionsRoute(routes, {
    authorization: observedAuthorization,
    async list() {
      throw new Error("not called");
    },
    logger,
  });

  assert.deepEqual(requirement, { staffRoles: ["producer"] });
  assert.equal(registration?.path, MY_COMMISSIONS_PATH);
  assert.equal(typeof registration?.access.authorization, "function");
  assert.equal("public" in (registration?.access ?? {}), false);
});

test("My Commissions handler fails closed without authorization context", async () => {
  let called = false;
  const handler = createMyCommissionsListHandler({
    async list() {
      called = true;
      throw new Error("must not run");
    },
    logger,
  });
  const error = await invoke(handler);
  assert.equal(error?.name, "MissingAuthorizationContextError");
  assert.equal(called, false);
});

async function invoke(handler: RequestHandler): Promise<Error | undefined> {
  const req = { query: {} } as Request;
  const res = { locals: {} } as Response;
  return new Promise((resolve, reject) => {
    const next: NextFunction = (error?: unknown) => {
      if (error === undefined) {
        resolve(undefined);
      } else if (error instanceof Error) {
        resolve(error);
      } else {
        reject(error);
      }
    };
    handler(req, res, next);
  });
}
