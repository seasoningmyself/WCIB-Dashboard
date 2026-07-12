import assert from "node:assert/strict";
import { test } from "node:test";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createAuthorizationGuards } from "../auth/authorization.js";
import type { AppLogger } from "../logging/logger.js";
import {
  MY_ITEMS_PATH,
  createMyItemsHandler,
  registerMyItemsRoute,
} from "./my-items.js";
import type { RouteAccessDeclaration, RouteRegistrar } from "./routes.js";

const logger: AppLogger = { error() {}, info() {}, warn() {} };

test("My Items route declares employee and producer authorization", () => {
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

  registerMyItemsRoute(routes, {
    authorization: {
      require(value) {
        requirement = value;
        return authorization.require(value);
      },
    },
    async list() {
      return [];
    },
    logger,
  });

  assert.deepEqual(requirement, { staffRoles: ["employee", "producer"] });
  assert.equal(registration?.path, MY_ITEMS_PATH);
  assert.equal(typeof registration?.access.authorization, "function");
  assert.equal("public" in (registration?.access ?? {}), false);
});

test("My Items handler fails closed without authorization context", async () => {
  let called = false;
  const handler = createMyItemsHandler({
    async list() {
      called = true;
      return [];
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
