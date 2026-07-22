import assert from "node:assert/strict";
import { test } from "node:test";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AccessPrincipal } from "../auth/access.js";
import { createAuthorizationGuards } from "../auth/authorization.js";
import type { UserAccount } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import {
  ADMIN_ACCOUNT_SECURITY_CAPABILITY_PATH,
  ADMIN_ACCOUNT_SECURITY_EMAIL_PATH,
  ADMIN_ACCOUNT_SECURITY_MFA_RESET_PATH,
  ADMIN_ACCOUNT_SECURITY_PATH,
  ADMIN_ACCOUNT_SECURITY_SUPPORT_CAPABILITY_PATH,
  registerAdminAccountSecurityRoutes,
} from "./admin-account-security.js";
import { toErrorResponse } from "./errors.js";
import type { RouteAccessDeclaration, RouteRegistrar } from "./routes.js";

const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000001";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000002";
const TARGET_ID = "00000000-0000-4000-8000-000000000003";
const logger: AppLogger = { error() {}, info() {}, warn() {} };

interface Registration {
  access: RouteAccessDeclaration;
  handler: RequestHandler;
  method: "GET" | "PATCH" | "POST";
  path: string;
}

test("Account Security denies employee and producer callers before every handler", async () => {
  for (const identity of ["employee", "producer"] as const) {
    const fixture = createFixture();
    for (const registration of fixture.registrations) {
      const result = await invokeGuard(registration, identity);
      assert.equal(result.statusCode, 403);
      assert.equal((result.body as any).error.code, "forbidden");
    }
    assert.equal(fixture.handlerCalls, 0);
  }
});

test("Account Security declares only the five guarded administrator routes", () => {
  const fixture = createFixture();
  assert.deepEqual(
    fixture.registrations.map(({ access, method, path }) => ({
      guarded: typeof access.authorization === "function",
      method,
      path,
      public: "public" in access,
    })),
    [
      { guarded: true, method: "GET", path: ADMIN_ACCOUNT_SECURITY_PATH, public: false },
      { guarded: true, method: "PATCH", path: ADMIN_ACCOUNT_SECURITY_CAPABILITY_PATH, public: false },
      { guarded: true, method: "PATCH", path: ADMIN_ACCOUNT_SECURITY_SUPPORT_CAPABILITY_PATH, public: false },
      { guarded: true, method: "PATCH", path: ADMIN_ACCOUNT_SECURITY_EMAIL_PATH, public: false },
      { guarded: true, method: "POST", path: ADMIN_ACCOUNT_SECURITY_MFA_RESET_PATH, public: false },
    ],
  );
});

function createFixture(): { handlerCalls: number; registrations: Registration[] } {
  const users = new Map<string, UserAccount>([
    [EMPLOYEE_ID, account(EMPLOYEE_ID)],
    [PRODUCER_ID, account(PRODUCER_ID)],
  ]);
  const principals = new Map<string, AccessPrincipal>([
    [EMPLOYEE_ID, principal(EMPLOYEE_ID, "employee")],
    [PRODUCER_ID, principal(PRODUCER_ID, "producer")],
  ]);
  const authorization = createAuthorizationGuards({
    async findUser(userId) { return users.get(userId) ?? null; },
    async loadPrincipal(userId) { return principals.get(userId) ?? null; },
    logger,
  });
  const registrations: Registration[] = [];
  const routes = {
    get(path: string, access: RouteAccessDeclaration, ...handlers: RequestHandler[]) {
      registrations.push({ access, handler: handlers[0]!, method: "GET", path });
    },
    patch(path: string, access: RouteAccessDeclaration, ...handlers: RequestHandler[]) {
      registrations.push({ access, handler: handlers[0]!, method: "PATCH", path });
    },
    post(path: string, access: RouteAccessDeclaration, ...handlers: RequestHandler[]) {
      registrations.push({ access, handler: handlers[0]!, method: "POST", path });
    },
  } as unknown as RouteRegistrar;
  const result = { handlerCalls: 0, registrations };
  const called = async () => {
    result.handlerCalls += 1;
  };
  registerAdminAccountSecurityRoutes(routes, {
    authorization,
    async list() {
      result.handlerCalls += 1;
      return [];
    },
    resetMfa: called,
    setAdminCapability: called,
    setSupportCapability: called,
    updateEmail: called,
  });
  return result;
}

async function invokeGuard(
  registration: Registration,
  identity: "employee" | "producer",
): Promise<{ body: unknown; statusCode: number }> {
  const userId = identity === "employee" ? EMPLOYEE_ID : PRODUCER_ID;
  const req = {
    body: {},
    headers: {},
    method: registration.method,
    originalUrl: registration.path,
    params: { userId: TARGET_ID },
    route: { path: registration.path },
    session: {
      authenticationState: "authenticated",
      cookie: {},
      sessionVersion: 0,
      userId,
    },
    sessionID: `${identity}-session`,
  } as unknown as Request;
  const res = { locals: {} } as Response;
  const error = await new Promise<unknown>((resolve) => {
    registration.access.authorization!(req, res, ((caught?: unknown) => {
      resolve(caught);
    }) as NextFunction);
  });
  const mapped = toErrorResponse(error);
  return { body: mapped.response, statusCode: mapped.statusCode };
}

function account(id: string): UserAccount {
  return {
    createdAt: new Date("2026-07-21T00:00:00.000Z"),
    displayName: id,
    email: `${id}@example.test`,
    id,
    isActive: true,
    passwordChangeRequiredAt: null,
    sessionVersion: 0,
  };
}

function principal(
  userId: string,
  staffRole: "employee" | "producer",
): AccessPrincipal {
  return {
    capabilities: [],
    staffRole,
    userActive: true,
    userId,
  };
}
