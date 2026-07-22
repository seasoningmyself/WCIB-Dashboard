import assert from "node:assert/strict";
import { test } from "node:test";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AccessPrincipal } from "../auth/access.js";
import { createAuthorizationGuards } from "../auth/authorization.js";
import type { MfaAccessState } from "../auth/mfa-state.js";
import type { UserAccount } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import { toErrorResponse } from "./errors.js";
import type { RouteAccessDeclaration, RouteRegistrar } from "./routes.js";
import {
  SUPPORT_ACCOUNT_MFA_RESET_PATH,
  registerSupportAccountSecurityRoutes,
} from "./support-account-security.js";

const SUPPORT_ID = "00000000-0000-4000-8000-000000000001";
const ADMIN_ID = "00000000-0000-4000-8000-000000000002";
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000003";
const TARGET_ID = "00000000-0000-4000-8000-000000000004";
const logger: AppLogger = { error() {}, info() {}, warn() {} };

test("support MFA reset route requires support_engineer exactly", async () => {
  const fixture = createFixture();

  for (const identity of ["admin", "employee"] as const) {
    const result = await invokeGuard(fixture.registration, identity);
    assert.equal(result.statusCode, 403);
  }
  assert.equal(fixture.handlerCalls(), 0);

  const allowed = await invokeGuard(fixture.registration, "support");
  assert.equal(allowed.statusCode, 200);
});

test("support MFA reset registers one guarded mutation route", () => {
  const fixture = createFixture();
  assert.equal(fixture.registration.method, "POST");
  assert.equal(fixture.registration.path, SUPPORT_ACCOUNT_MFA_RESET_PATH);
  assert.equal(
    typeof fixture.registration.access.authorization,
    "function",
  );
});

test("unenrolled support is denied before the reset handler", async () => {
  const fixture = createFixture({ supportMfaRequired: true });
  const result = await invokeGuard(fixture.registration, "support");

  assert.equal(result.statusCode, 403);
  assert.equal(fixture.handlerCalls(), 0);
});

interface Registration {
  access: RouteAccessDeclaration;
  handler: RequestHandler;
  method: "POST";
  path: string;
}

function createFixture(options: { supportMfaRequired?: boolean } = {}): {
  handlerCalls(): number;
  registration: Registration;
} {
  const accounts = new Map([
    [SUPPORT_ID, account(SUPPORT_ID)],
    [ADMIN_ID, account(ADMIN_ID)],
    [EMPLOYEE_ID, account(EMPLOYEE_ID)],
  ]);
  const principals = new Map<string, AccessPrincipal>([
    [SUPPORT_ID, principal(SUPPORT_ID, ["support_engineer"])],
    [ADMIN_ID, principal(ADMIN_ID, ["admin"])],
    [
      EMPLOYEE_ID,
      {
        capabilities: [],
        staffRole: "employee",
        userActive: true,
        userId: EMPLOYEE_ID,
      },
    ],
  ]);
  const authorization = createAuthorizationGuards({
    async findUser(userId) {
      return accounts.get(userId) ?? null;
    },
    async loadPrincipal(userId) {
      return principals.get(userId) ?? null;
    },
    ...(options.supportMfaRequired === true
      ? {
          async loadMfaState(userId: string): Promise<MfaAccessState> {
            return userId === SUPPORT_ID
              ? {
                  activeMethodCount: 0,
                  enrolled: false,
                  enrollmentIncomplete: false,
                  enforcementEnabled: false,
                  policyRequired: true,
                  recoveryCodesAcknowledged: false,
                  requiresMfaLogin: false,
                }
              : {
                  activeMethodCount: 0,
                  enrolled: false,
                  enrollmentIncomplete: false,
                  enforcementEnabled: false,
                  policyRequired: false,
                  recoveryCodesAcknowledged: false,
                  requiresMfaLogin: false,
                };
          },
        }
      : {}),
    logger,
  });
  const registrations: Registration[] = [];
  let calls = 0;
  const routes = {
    post(
      path: string,
      access: RouteAccessDeclaration,
      ...handlers: RequestHandler[]
    ) {
      registrations.push({ access, handler: handlers[0]!, method: "POST", path });
    },
  } as unknown as RouteRegistrar;
  registerSupportAccountSecurityRoutes(routes, {
    authorization,
    async resetMfa() {
      calls += 1;
    },
  });
  assert.equal(registrations.length, 1);
  return {
    handlerCalls: () => calls,
    registration: registrations[0]!,
  };
}

async function invokeGuard(
  registration: Registration,
  identity: "admin" | "employee" | "support",
): Promise<{ statusCode: number }> {
  const userId =
    identity === "support"
      ? SUPPORT_ID
      : identity === "admin"
        ? ADMIN_ID
        : EMPLOYEE_ID;
  const request = {
    body: { reason: "Lost authentication device" },
    header() {
      return "step-up-token";
    },
    headers: {},
    method: "POST",
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
  const response = {
    end() {},
    locals: {},
    status() {
      return this;
    },
  } as unknown as Response;
  const guardError = await new Promise<unknown>((resolve) => {
    registration.access.authorization!(
      request,
      response,
      ((error?: unknown) => resolve(error)) as NextFunction,
    );
  });
  if (guardError !== undefined) {
    return { statusCode: toErrorResponse(guardError).statusCode };
  }
  await registration.handler(request, response, (() => undefined) as NextFunction);
  return { statusCode: 200 };
}

function account(id: string): UserAccount {
  return {
    createdAt: new Date("2026-07-22T00:00:00.000Z"),
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
  capabilities: AccessPrincipal["capabilities"],
): AccessPrincipal {
  return {
    capabilities,
    staffRole: null,
    userActive: true,
    userId,
  };
}
