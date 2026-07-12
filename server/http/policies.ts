import type { RequestHandler, Response } from "express";
import {
  adminLedgerPolicySchema,
  policyLedgerDetailResponseSchema,
  policyLedgerItemSchema,
  policyLedgerListQuerySchema,
  policyLedgerListResponseSchema,
  policyLedgerParamsSchema,
  type PolicyLedgerItem,
} from "../../shared/policy-ledger.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import type { AppLogger } from "../logging/logger.js";
import {
  PolicyLedgerBoundsError,
  PolicyLedgerNotFoundError,
  type PolicyLedgerSourceItem,
  type PolicyLedgerSourceList,
} from "../policies/ledger.js";
import { POLICY_LEDGER_ADMIN_ACCESS } from "../policies/ledger-access.js";
import { projectAdminPolicy } from "../policies/projection.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const POLICY_LEDGER_LIST_PATH = "/api/policies";
export const POLICY_LEDGER_DETAIL_PATH = "/api/policies/:policyId";

export interface PolicyLedgerHandlerDependencies {
  get(
    context: AuthorizedRequestContext,
    policyId: string,
  ): Promise<PolicyLedgerSourceItem>;
  list(
    context: AuthorizedRequestContext,
    query: unknown,
  ): Promise<PolicyLedgerSourceList>;
  logger: AppLogger;
}

export interface RegisterPolicyLedgerRoutesOptions
  extends PolicyLedgerHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createPolicyLedgerListHandler(
  dependencies: PolicyLedgerHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const query = policyLedgerListQuerySchema.parse(req.query);
    let source: PolicyLedgerSourceList;
    try {
      source = await dependencies.list(context, query);
    } catch (error) {
      throw mapPolicyLedgerError(error);
    }
    const items = source.items.map((item) => projectLedgerItem(res, item));
    const response = policyLedgerListResponseSchema.parse({
      ...source,
      items,
    });
    dependencies.logger.info("Policy ledger loaded", {
      component: "policy_ledger",
      event: "ledger_read",
      filteredCount: response.filteredTotal,
      resultCount: response.items.length,
      userId: context.principal.userId,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function createPolicyLedgerDetailHandler(
  dependencies: PolicyLedgerHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { policyId } = policyLedgerParamsSchema.parse(req.params);
    let source: PolicyLedgerSourceItem;
    try {
      source = await dependencies.get(context, policyId);
    } catch (error) {
      throw mapPolicyLedgerError(error);
    }
    const response = policyLedgerDetailResponseSchema.parse({
      item: projectLedgerItem(res, source),
    });
    dependencies.logger.info("Policy ledger item loaded", {
      component: "policy_ledger",
      event: "ledger_item_read",
      policyId,
      userId: context.principal.userId,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerPolicyLedgerRoutes(
  routes: RouteRegistrar,
  options: RegisterPolicyLedgerRoutesOptions,
): void {
  const access = {
    authorization: options.authorization.require(POLICY_LEDGER_ADMIN_ACCESS),
  };
  routes.get(
    POLICY_LEDGER_LIST_PATH,
    access,
    createPolicyLedgerListHandler(options),
  );
  routes.get(
    POLICY_LEDGER_DETAIL_PATH,
    access,
    createPolicyLedgerDetailHandler(options),
  );
}

function projectLedgerItem(
  res: Response,
  source: PolicyLedgerSourceItem,
): PolicyLedgerItem {
  const projected = projectAuthorizedFields(
    res,
    source.policy,
    projectAdminPolicy,
  );
  if (projected === null) {
    throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  return policyLedgerItemSchema.parse({
    duplicate: source.duplicate,
    labels: source.labels,
    policy: adminLedgerPolicySchema.parse(projected),
  });
}

function mapPolicyLedgerError(error: unknown): unknown {
  if (error instanceof PolicyLedgerNotFoundError) {
    return new HttpError(404, apiErrorCodes.notFound, "Policy not found");
  }
  if (error instanceof PolicyLedgerBoundsError) {
    return new HttpError(
      400,
      apiErrorCodes.badRequest,
      "Policy ledger query is invalid",
    );
  }
  return error;
}
