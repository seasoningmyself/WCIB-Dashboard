import assert from "node:assert/strict";
import { test } from "node:test";
import express, { type RequestHandler } from "express";
import { createApp } from "../app.js";
import {
  AUTHENTICATED_ACCESS,
  createAuthorizationGuards,
} from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import {
  LOGIN_PATH,
  LOGOUT_PATH,
  registerAuthRoutes,
} from "./auth.js";
import {
  PASSWORD_RESET_CONFIRM_PATH,
  PASSWORD_RESET_REQUEST_PATH,
} from "./password-reset.js";
import { CSP_REPORT_PATH } from "../../shared/security-policy.js";
import {
  auditRouteAccessDeclarations,
  createRouteRegistrar,
  RouteAccessDeclarationError,
} from "./routes.js";

const logger: AppLogger = {
  error() {},
  info() {},
  warn() {},
};

const handler: RequestHandler = (_req, res) => {
  res.status(204).end();
};

function createAuthorization() {
  return createAuthorizationGuards({
    async findUser() {
      return null;
    },
    async loadPrincipal() {
      return null;
    },
    logger,
  });
}

test("route registration requires exactly one explicit access decision", () => {
  const app = express();
  const routes = createRouteRegistrar(app);
  const unsafeRegister = routes.get as unknown as (
    path: string,
    access: unknown,
    ...handlers: RequestHandler[]
  ) => void;

  assert.throws(
    () => unsafeRegister("/missing", {}, handler),
    (error: unknown) =>
      error instanceof RouteAccessDeclarationError &&
      error.message ===
        "GET /missing must declare either authorization or intentional public access",
  );
  assert.throws(
    () => unsafeRegister("/public-without-reason", { public: true }, handler),
    /public access requires a non-empty reason/,
  );
  assert.throws(
    () =>
      unsafeRegister(
        "/conflicting",
        {
          authorization: createAuthorization().require(AUTHENTICATED_ACCESS),
          public: true,
          reason: "Conflicting declaration",
        },
        handler,
      ),
    /must declare either authorization or intentional public access/,
  );
  assert.throws(
    () =>
      unsafeRegister(
        "/untrusted-guard",
        { authorization: handler },
        handler,
      ),
    /authorization must use authorization\.require/,
  );
  assert.deepEqual(auditRouteAccessDeclarations(app), []);
});

test("route registration records public and guarded declarations", () => {
  const app = express();
  const routes = createRouteRegistrar(app);
  const authorization = createAuthorization();

  routes.get(
    "/public",
    { public: true, reason: "Anonymous callers need this status" },
    handler,
  );
  routes.post(
    "/guarded",
    {
      authorization: authorization.require(AUTHENTICATED_ACCESS),
    },
    handler,
  );

  assert.deepEqual(auditRouteAccessDeclarations(app), [
    {
      access: {
        reason: "Anonymous callers need this status",
        type: "public",
      },
      method: "GET",
      path: "/public",
    },
    {
      access: { type: "authorized" },
      method: "POST",
      path: "/guarded",
    },
  ]);
});

test("route audit rejects a route registered directly with Express", () => {
  const app = express();
  const routes = createRouteRegistrar(app);
  routes.get(
    "/declared",
    { public: true, reason: "Test declared route" },
    handler,
  );

  app.get("/undeclared", handler);

  assert.throws(
    () => auditRouteAccessDeclarations(app),
    (error: unknown) =>
      error instanceof RouteAccessDeclarationError &&
      error.message ===
        "Routes lack explicit access declarations: GET /undeclared",
  );
});

test("app creation fails when a route omits its access declaration", () => {
  assert.throws(
    () =>
      createApp({
        registerRoutes(routes) {
          const unsafeRegister = routes.get as unknown as (
            path: string,
            access: unknown,
            ...handlers: RequestHandler[]
          ) => void;
          unsafeRegister("/api/undeclared", undefined, handler);
        },
      }),
    /GET \/api\/undeclared must declare either authorization or intentional public access/,
  );
});

test("every Foundation route has an explicit audited declaration", () => {
  const app = createApp({
    registerRoutes(routes) {
      registerAuthRoutes(routes, {
        database: {} as AuthDatabase,
        logger,
      });
    },
  });

  const declarations = auditRouteAccessDeclarations(app);
  assert.deepEqual(
    declarations.map(({ access, method, path }) => ({
      access: access.type,
      method,
      path,
    })),
    [
      { access: "public", method: "GET", path: "/health" },
      { access: "public", method: "GET", path: "/ready" },
      { access: "public", method: "POST", path: CSP_REPORT_PATH },
      { access: "public", method: "GET", path: "/api" },
      { access: "public", method: "POST", path: LOGIN_PATH },
      { access: "public", method: "POST", path: LOGOUT_PATH },
      {
        access: "public",
        method: "POST",
        path: PASSWORD_RESET_REQUEST_PATH,
      },
      {
        access: "public",
        method: "POST",
        path: PASSWORD_RESET_CONFIRM_PATH,
      },
    ],
  );
  assert.equal(
    declarations.every(
      ({ access }) =>
        access.type === "authorized" || access.reason.length > 0,
    ),
    true,
  );
});
