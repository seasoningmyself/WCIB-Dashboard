import type { RequestHandler } from "express";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  deletedPolicyListResponseSchema,
  policyRestoreRequestSchema,
  policyRestoreResponseSchema,
  policySoftDeleteRequestSchema,
  policySoftDeleteResponseSchema,
} from "../../shared/policy-deletions.js";
import { policyLedgerParamsSchema } from "../../shared/policy-ledger.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import type { AppLogger } from "../logging/logger.js";
import {
  PolicyLedgerBoundsError,
  type DeletedPolicyLedgerSourceItem,
  type PolicyLedgerSourceItem,
} from "../policies/ledger.js";
import { POLICY_LEDGER_ADMIN_ACCESS } from "../policies/ledger-access.js";
import {
  PolicyDeletionNotFoundError,
  PolicyDeletionStaleError,
  PolicyDeletionValidationError,
  type PolicyRestoreResult,
  type PolicySoftDeleteResult,
} from "../policies/soft-delete.js";
import {
  projectAdminDeletedPolicy,
  projectAdminPolicy,
} from "../policies/projection.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const DELETED_POLICY_LIST_PATH = "/api/deleted-policies";
export const POLICY_SOFT_DELETE_PATH = "/api/policies/:policyId/soft-delete";
export const POLICY_RESTORE_PATH = "/api/deleted-policies/:policyId/restore";

export interface PolicyDeletionHandlerDependencies {
  list(context: AuthorizedRequestContext): Promise<readonly DeletedPolicyLedgerSourceItem[]>;
  logger: AppLogger;
  restore(
    context: AuthorizedRequestContext,
    policyId: string,
    input: unknown,
  ): Promise<PolicyRestoreResult>;
  softDelete(
    context: AuthorizedRequestContext,
    policyId: string,
    input: unknown,
  ): Promise<PolicySoftDeleteResult>;
}

export interface RegisterPolicyDeletionRoutesOptions
  extends PolicyDeletionHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createDeletedPolicyListHandler(
  dependencies: PolicyDeletionHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (_req, res) => {
    const context = getAuthorizedRequestContext(res);
    let source: readonly DeletedPolicyLedgerSourceItem[];
    try {
      source = await dependencies.list(context);
    } catch (error) {
      if (error instanceof PolicyLedgerBoundsError) {
        throw new HttpError(409, apiErrorCodes.badRequest, "Deleted policy list is too large");
      }
      throw error;
    }
    const response = deletedPolicyListResponseSchema.parse({
      items: source.map((item) => projectDeletedItem(res, item)),
    });
    dependencies.logger.info("Deleted policy records loaded", {
      component: "policy_deletion",
      event: "deleted_policy_list_read",
      resultCount: response.items.length,
      userId: context.principal.userId,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function createPolicySoftDeleteHandler(
  dependencies: PolicyDeletionHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { policyId } = policyLedgerParamsSchema.parse(req.params);
    const input = policySoftDeleteRequestSchema.parse(req.body);
    let result: PolicySoftDeleteResult;
    try {
      result = await dependencies.softDelete(context, policyId, input);
    } catch (error) {
      throw mapPolicyDeletionError(error);
    }
    const response = policySoftDeleteResponseSchema.parse({
      changed: result.changed,
      detachedOpenSheetCount: result.detachedOpenSheetCount,
      item: projectDeletedItem(res, result.source),
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function createPolicyRestoreHandler(
  dependencies: PolicyDeletionHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { policyId } = policyLedgerParamsSchema.parse(req.params);
    const input = policyRestoreRequestSchema.parse(req.body);
    let result: PolicyRestoreResult;
    try {
      result = await dependencies.restore(context, policyId, input);
    } catch (error) {
      throw mapPolicyDeletionError(error);
    }
    const response = policyRestoreResponseSchema.parse({
      changed: result.changed,
      item: projectActiveItem(res, result.source),
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerPolicyDeletionRoutes(
  routes: RouteRegistrar,
  options: RegisterPolicyDeletionRoutesOptions,
): void {
  const access = {
    authorization: options.authorization.require(POLICY_LEDGER_ADMIN_ACCESS),
  };
  routes.get(
    DELETED_POLICY_LIST_PATH,
    access,
    createDeletedPolicyListHandler(options),
  );
  routes.post(
    POLICY_SOFT_DELETE_PATH,
    access,
    createPolicySoftDeleteHandler(options),
  );
  routes.post(
    POLICY_RESTORE_PATH,
    access,
    createPolicyRestoreHandler(options),
  );
}

function projectDeletedItem(
  res: Parameters<typeof projectAuthorizedFields>[0],
  source: DeletedPolicyLedgerSourceItem,
) {
  const projected = projectAuthorizedFields(res, source.policy, projectAdminDeletedPolicy);
  if (projected === null) {
    throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  return { ...projected, labels: source.labels };
}

function projectActiveItem(
  res: Parameters<typeof projectAuthorizedFields>[0],
  source: PolicyLedgerSourceItem,
) {
  const policy = projectAuthorizedFields(res, source.policy, projectAdminPolicy);
  if (policy === null) {
    throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  return { duplicate: source.duplicate, labels: source.labels, policy };
}

function mapPolicyDeletionError(error: unknown): unknown {
  if (error instanceof PolicyDeletionNotFoundError) {
    return new HttpError(404, apiErrorCodes.notFound, "Policy not found");
  }
  if (error instanceof PolicyDeletionStaleError) {
    return new HttpError(409, apiErrorCodes.badRequest, "Policy changed; reload and try again");
  }
  if (error instanceof PolicyDeletionValidationError) {
    return new HttpError(400, apiErrorCodes.badRequest, "Policy deletion request is invalid");
  }
  return error;
}
