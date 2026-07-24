import assert from "node:assert/strict";
import { test } from "node:test";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AccessPrincipal } from "../auth/access.js";
import { createAuthorizationGuards } from "../auth/authorization.js";
import type { MfaAccessState } from "../auth/mfa-state.js";
import type { UserAccount } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import { registerAdminAccountSecurityRoutes } from "./admin-account-security.js";
import { registerAdminOfficeRoutes } from "./admin-office-locations.js";
import { registerAdminStaffRoutes } from "./admin-staff.js";
import { registerAdminVocabularyRoutes } from "./admin-vocabulary.js";
import { registerApprovalActionRoutes } from "./approval-actions.js";
import { registerApprovalWorkRoute } from "./approval-queue.js";
import { registerApprovalWorkDeletionRoutes } from "./approval-work-deletions.js";
import { registerBusinessStateRoutes } from "./business-state.js";
import {
  registerDraftCreateRoute,
  registerDraftDiscardRoute,
  registerDraftEditRoute,
  registerDraftFlagRoute,
  registerDraftListRoute,
  registerDraftSubmitRoute,
  registerDraftWithdrawHelpRoute,
  registerDraftWithdrawSubmissionRoute,
} from "./drafts.js";
import { registerDraftAssignmentOptionsRoute } from "./draft-assignment-options.js";
import { toErrorResponse } from "./errors.js";
import { registerIpfsPriorFinancingRoute } from "./ipfs.js";
import { registerIpfsWorkQueueRoute } from "./ipfs-work-queue.js";
import { registerPolicyIpfsPushedRoute } from "./ipfs-pushed.js";
import { registerKpiActualRoute } from "./kpi-actuals.js";
import { registerKpiRecentActivityRoute } from "./kpi-activity.js";
import { registerKpiTargetRoutes } from "./kpi-targets.js";
import { registerMgaPayableGroupStateRoute } from "./mga-payable-group-state.js";
import { registerMgaPayableStateRoute } from "./mga-payable-state.js";
import { registerMgaPayableRoute } from "./mga-payables.js";
import {
  registerMyCommissionReceiptRoute,
  registerMyCommissionsRoute,
} from "./my-commissions.js";
import { registerMyItemsRoute } from "./my-items.js";
import { registerPaySheetAdjustmentRoutes } from "./pay-sheet-adjustments.js";
import { registerPaySheetBootstrapRoute } from "./pay-sheet-bootstrap.js";
import { registerPaySheetCloseRoute } from "./pay-sheet-close.js";
import { registerPaySheetExportRoutes } from "./pay-sheet-exports.js";
import { registerPaySheetReadRoutes } from "./pay-sheets.js";
import { registerPolicyChangeRequestRoutes } from "./policy-change-requests.js";
import { registerPolicyLedgerCorrectionRoute } from "./policy-corrections.js";
import { registerPolicyDeletionRoutes } from "./policy-deletions.js";
import { registerPolicyLedgerRoutes } from "./policies.js";
import type { RouteAccessDeclaration, RouteRegistrar } from "./routes.js";
import { registerSupportAccountSecurityRoutes } from "./support-account-security.js";
import { registerSupportDashboardRoutes } from "./support-dashboard.js";
import {
  registerActiveVocabularyRoute,
  registerMgaMutationRoute,
  registerVocabularyMutationRoutes,
} from "./vocabulary.js";

const SUPPORT_ID = "00000000-0000-4000-8000-000000000001";
const ADMIN_ID = "00000000-0000-4000-8000-000000000002";
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000003";
const TARGET_ID = "00000000-0000-4000-8000-000000000004";
const logger: AppLogger = { error() {}, info() {}, warn() {} };

interface Registration {
  access: RouteAccessDeclaration;
  group: string;
  method: string;
  path: string;
}

type RegisterRoutes = (routes: RouteRegistrar, options: never) => void;

test("support engineer is denied every business and administrator route family", async () => {
  const fixture = createFixture();
  const forbiddenGroups = registerForbiddenGroups(fixture);

  assert.deepEqual(
    [...new Set(fixture.registrations.map(({ group }) => group))].sort(),
    forbiddenGroups.sort(),
  );
  assert.ok(fixture.registrations.length >= 50);
  for (const registration of fixture.registrations) {
    const result = await invokeGuard(registration, SUPPORT_ID);
    assert.equal(result.statusCode, 403, `${registration.method} ${registration.path}`);
    assert.equal(result.code, "forbidden", `${registration.method} ${registration.path}`);
  }
});

test("support-only routes reject admins and non-holders while offices allow admin or support", async () => {
  const fixture = createFixture();
  fixture.registerGroup("support_dashboard", registerSupportDashboardRoutes);
  fixture.registerGroup("support_account_security", registerSupportAccountSecurityRoutes);
  const supportRoutes = [...fixture.registrations];
  assert.deepEqual(
    supportRoutes.map(({ method, path }) => `${method} ${path}`),
    [
      "GET /api/support/dashboard",
      "GET /api/support/accounts",
      "POST /api/support/accounts/:userId/mfa-reset",
    ],
  );
  for (const registration of supportRoutes) {
    assert.equal((await invokeGuard(registration, SUPPORT_ID)).statusCode, 200);
    assert.equal((await invokeGuard(registration, ADMIN_ID)).statusCode, 403);
    assert.equal((await invokeGuard(registration, EMPLOYEE_ID)).statusCode, 403);
  }

  fixture.registrations.length = 0;
  fixture.registerGroup("office_management", registerAdminOfficeRoutes);
  assert.equal(fixture.registrations.length, 5);
  for (const registration of fixture.registrations) {
    assert.equal((await invokeGuard(registration, SUPPORT_ID)).statusCode, 200);
    assert.equal((await invokeGuard(registration, ADMIN_ID)).statusCode, 200);
    assert.equal((await invokeGuard(registration, EMPLOYEE_ID)).statusCode, 403);
  }
  assert.equal(
    fixture.registrations.some(({ method }) => method === "DELETE"),
    false,
  );
});

function registerForbiddenGroups(fixture: ReturnType<typeof createFixture>): string[] {
  const groups: Array<[string, RegisterRoutes]> = [
    ["account_security", registerAdminAccountSecurityRoutes],
    ["admin_staff", registerAdminStaffRoutes],
    ["admin_vocabulary", registerAdminVocabularyRoutes],
    ["approval_actions", registerApprovalActionRoutes],
    ["approval_queue", registerApprovalWorkRoute],
    ["approval_deletions", registerApprovalWorkDeletionRoutes],
    ["business_state", registerBusinessStateRoutes],
    ["draft_assignments", registerDraftAssignmentOptionsRoute],
    ["draft_create", registerDraftCreateRoute],
    ["draft_discard", registerDraftDiscardRoute],
    ["draft_edit", registerDraftEditRoute],
    ["draft_flag", registerDraftFlagRoute],
    ["draft_list", registerDraftListRoute],
    ["draft_submit", registerDraftSubmitRoute],
    ["draft_withdraw_help", registerDraftWithdrawHelpRoute],
    ["draft_withdraw_submission", registerDraftWithdrawSubmissionRoute],
    ["ipfs_history", registerIpfsPriorFinancingRoute],
    ["ipfs_pushed", registerPolicyIpfsPushedRoute],
    ["ipfs_work_queue", registerIpfsWorkQueueRoute],
    ["kpi_actuals", registerKpiActualRoute],
    ["kpi_activity", registerKpiRecentActivityRoute],
    ["kpi_targets", registerKpiTargetRoutes],
    ["mga_group_state", registerMgaPayableGroupStateRoute],
    ["mga_state", registerMgaPayableStateRoute],
    ["mga_payables", registerMgaPayableRoute],
    ["my_commission_receipts", registerMyCommissionReceiptRoute],
    ["my_commissions", registerMyCommissionsRoute],
    ["my_items", registerMyItemsRoute],
    ["pay_sheet_adjustments", registerPaySheetAdjustmentRoutes],
    ["pay_sheet_bootstrap", registerPaySheetBootstrapRoute],
    ["pay_sheet_close", registerPaySheetCloseRoute],
    ["pay_sheet_exports", registerPaySheetExportRoutes],
    ["pay_sheet_reads", registerPaySheetReadRoutes],
    ["policy_change_requests", registerPolicyChangeRequestRoutes],
    ["policy_corrections", registerPolicyLedgerCorrectionRoute],
    ["policy_deletions", registerPolicyDeletionRoutes],
    ["policy_ledger", registerPolicyLedgerRoutes],
    ["vocabulary_active", registerActiveVocabularyRoute],
    ["vocabulary_create", registerVocabularyMutationRoutes],
    ["vocabulary_mga", registerMgaMutationRoute],
  ];
  for (const [name, register] of groups) fixture.registerGroup(name, register);
  return groups.map(([name]) => name);
}

function createFixture() {
  const accounts = new Map<string, UserAccount>([
    [SUPPORT_ID, account(SUPPORT_ID)],
    [ADMIN_ID, account(ADMIN_ID)],
    [EMPLOYEE_ID, account(EMPLOYEE_ID)],
  ]);
  const principals = new Map<string, AccessPrincipal>([
    [SUPPORT_ID, principal(SUPPORT_ID, ["support_engineer"], null)],
    [ADMIN_ID, principal(ADMIN_ID, ["admin"], null)],
    [EMPLOYEE_ID, principal(EMPLOYEE_ID, [], "employee")],
  ]);
  const authorization = createAuthorizationGuards({
    async findUser(userId) { return accounts.get(userId) ?? null; },
    async loadMfaState(): Promise<MfaAccessState> {
      return {
        activeMethodCount: 1,
        enrolled: true,
        enrollmentIncomplete: false,
        enforcementEnabled: true,
        policyRequired: true,
        recoveryCodesAcknowledged: true,
        requiresMfaLogin: true,
      };
    },
    async loadPrincipal(userId) { return principals.get(userId) ?? null; },
    logger,
  });
  const registrations: Registration[] = [];
  let currentGroup = "unassigned";
  const record = (method: string) => (
    path: string,
    access: RouteAccessDeclaration,
    ..._handlers: RequestHandler[]
  ) => {
    registrations.push({ access, group: currentGroup, method, path });
  };
  const routes = {
    delete: record("DELETE"),
    get: record("GET"),
    head: record("HEAD"),
    options: record("OPTIONS"),
    patch: record("PATCH"),
    post: record("POST"),
    put: record("PUT"),
  } as unknown as RouteRegistrar;
  const options = new Proxy(
    { authorization, logger },
    {
      get(target, property) {
        if (property in target) return target[property as keyof typeof target];
        return async () => {
          throw new Error("A denied route handler must not run");
        };
      },
    },
  );
  return {
    registrations,
    registerGroup(name: string, register: RegisterRoutes) {
      currentGroup = name;
      register(routes, options as never);
    },
  };
}

async function invokeGuard(
  registration: Registration,
  userId: string,
): Promise<{ code: string | null; statusCode: number }> {
  assert.equal(typeof registration.access.authorization, "function");
  const request = {
    body: {},
    headers: {},
    method: registration.method,
    originalUrl: registration.path,
    params: {
      adjustmentId: TARGET_ID,
      draftId: TARGET_ID,
      generationId: TARGET_ID,
      itemId: TARGET_ID,
      mgaId: TARGET_ID,
      officeLocationId: TARGET_ID,
      paySheetId: TARGET_ID,
      policyId: TARGET_ID,
      queueEntryId: TARGET_ID,
      requestId: TARGET_ID,
      userId: TARGET_ID,
    },
    query: {},
    route: { path: registration.path },
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
    registration.access.authorization!(
      request,
      response,
      ((caught?: unknown) => resolve(caught)) as NextFunction,
    );
  });
  if (error === undefined) return { code: null, statusCode: 200 };
  const mapped = toErrorResponse(error);
  return {
    code: (mapped.response as { error?: { code?: string } }).error?.code ?? null,
    statusCode: mapped.statusCode,
  };
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
  staffRole: AccessPrincipal["staffRole"],
): AccessPrincipal {
  return { capabilities, staffRole, userActive: true, userId };
}
