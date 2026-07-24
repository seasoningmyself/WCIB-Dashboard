import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import type { AccessPrincipal } from "../auth/access.js";
import { createAuthorizationGuards } from "../auth/authorization.js";
import type { MfaAccessState } from "../auth/mfa-state.js";
import type { UserAccount } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import { toErrorResponse } from "./errors.js";
import {
  KPI_RECENT_ACTIVITY_PATH,
  registerKpiRecentActivityRoute,
} from "./kpi-activity.js";
import type { RouteAccessDeclaration, RouteRegistrar } from "./routes.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000002";
const PRODUCER_ID = "00000000-0000-4000-8000-000000000003";
const SUPPORT_ID = "00000000-0000-4000-8000-000000000004";
const logger: AppLogger = { error() {}, info() {}, warn() {} };

test("recent KPI activity is route-level admin-only", async () => {
  const accounts = new Map([
    [ADMIN_ID, account(ADMIN_ID)],
    [EMPLOYEE_ID, account(EMPLOYEE_ID)],
    [PRODUCER_ID, account(PRODUCER_ID)],
    [SUPPORT_ID, account(SUPPORT_ID)],
  ]);
  const principals = new Map<string, AccessPrincipal>([
    [ADMIN_ID, principal(ADMIN_ID, ["admin"], null)],
    [EMPLOYEE_ID, principal(EMPLOYEE_ID, [], "employee")],
    [PRODUCER_ID, principal(PRODUCER_ID, [], "producer")],
    [SUPPORT_ID, principal(SUPPORT_ID, ["support_engineer"], null)],
  ]);
  const authorization = createAuthorizationGuards({
    async findUser(userId) { return accounts.get(userId) ?? null; },
    async loadMfaState(): Promise<MfaAccessState> {
      return {
        activeMethodCount: 1,
        enrolled: true,
        enrollmentIncomplete: false,
        enforcementEnabled: false,
        policyRequired: false,
        recoveryCodesAcknowledged: true,
        requiresMfaLogin: true,
      };
    },
    async loadPrincipal(userId) { return principals.get(userId) ?? null; },
    logger,
  });
  let registration:
    | { access: RouteAccessDeclaration; path: string }
    | undefined;
  const routes = {
    get(
      path: string,
      access: RouteAccessDeclaration,
      ..._handlers: RequestHandler[]
    ) {
      registration = { access, path };
    },
  } as unknown as RouteRegistrar;

  registerKpiRecentActivityRoute(routes, {
    authorization,
    async list() {
      return { activities: [] };
    },
    logger,
  });

  assert.equal(registration?.path, KPI_RECENT_ACTIVITY_PATH);
  assert.ok(registration?.access.authorization);
  assert.equal(await invokeGuard(registration!.access, ADMIN_ID), 200);
  assert.equal(await invokeGuard(registration!.access, EMPLOYEE_ID), 403);
  assert.equal(await invokeGuard(registration!.access, PRODUCER_ID), 403);
  assert.equal(await invokeGuard(registration!.access, SUPPORT_ID), 403);
});

async function invokeGuard(
  access: RouteAccessDeclaration,
  userId: string,
): Promise<number> {
  const request = {
    body: {},
    headers: {},
    method: "GET",
    originalUrl: KPI_RECENT_ACTIVITY_PATH,
    params: {},
    query: {},
    route: { path: KPI_RECENT_ACTIVITY_PATH },
    session: {
      authenticationState: "authenticated",
      cookie: {},
      sessionVersion: 0,
      userId,
    },
    sessionID: `${userId}-session`,
  } as unknown as Request;
  const response = { locals: {} } as Response;
  const error = await new Promise<unknown>((resolve) => {
    access.authorization!(
      request,
      response,
      ((caught?: unknown) => resolve(caught)) as NextFunction,
    );
  });
  return error === undefined ? 200 : toErrorResponse(error).statusCode;
}

function account(id: string): UserAccount {
  return {
    createdAt: new Date("2026-07-23T00:00:00.000Z"),
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
  staffRole: AccessPrincipal["staffRole"],
): AccessPrincipal {
  return { capabilities, staffRole, userActive: true, userId };
}
