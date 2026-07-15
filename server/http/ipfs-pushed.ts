import type { RequestHandler } from "express";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  ipfsPushedStateRequestSchema,
  ipfsPushedStateResponseSchema,
} from "../../shared/ipfs.js";
import { policyLedgerParamsSchema } from "../../shared/policy-ledger.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import type { AppLogger } from "../logging/logger.js";
import {
  PolicyIpfsPushedNotFoundError,
  PolicyIpfsPushedStaleError,
  PolicyIpfsPushedValidationError,
  type PolicyIpfsPushedResult,
} from "../policies/ipfs-pushed.js";
import { POLICY_LEDGER_ADMIN_ACCESS } from "../policies/ledger-access.js";
import { asyncRoute, HttpError } from "./errors.js";
import { projectPolicyLedgerItem } from "./policies.js";
import type { RouteRegistrar } from "./routes.js";

export const POLICY_IPFS_PUSHED_PATH =
  "/api/policies/:policyId/ipfs-pushed";

export interface PolicyIpfsPushedHandlerDependencies {
  logger: AppLogger;
  setState(
    context: AuthorizedRequestContext,
    policyId: string,
    input: unknown,
  ): Promise<PolicyIpfsPushedResult>;
}

export interface RegisterPolicyIpfsPushedRouteOptions
  extends PolicyIpfsPushedHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createPolicyIpfsPushedHandler(
  dependencies: PolicyIpfsPushedHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { policyId } = policyLedgerParamsSchema.parse(req.params);
    const input = ipfsPushedStateRequestSchema.parse(req.body);
    let result: PolicyIpfsPushedResult;
    try {
      result = await dependencies.setState(context, policyId, input);
    } catch (error) {
      throw mapPolicyIpfsPushedError(error);
    }
    const response = ipfsPushedStateResponseSchema.parse({
      changed: result.changed,
      item: projectPolicyLedgerItem(res, result.source),
    });
    dependencies.logger.info("Policy IPFS pushed endpoint completed", {
      changed: result.changed,
      component: "ipfs",
      event: "policy_ipfs_pushed_endpoint_succeeded",
      policyId,
      pushed: input.pushed,
      userId: context.principal.userId,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerPolicyIpfsPushedRoute(
  routes: RouteRegistrar,
  options: RegisterPolicyIpfsPushedRouteOptions,
): void {
  routes.patch(
    POLICY_IPFS_PUSHED_PATH,
    {
      authorization: options.authorization.require(
        POLICY_LEDGER_ADMIN_ACCESS,
      ),
    },
    createPolicyIpfsPushedHandler(options),
  );
}

function mapPolicyIpfsPushedError(error: unknown): unknown {
  if (error instanceof PolicyIpfsPushedNotFoundError) {
    return new HttpError(404, apiErrorCodes.notFound, "Policy not found");
  }
  if (error instanceof PolicyIpfsPushedStaleError) {
    return new HttpError(
      409,
      apiErrorCodes.badRequest,
      "Policy changed; reload before updating IPFS state",
    );
  }
  if (error instanceof PolicyIpfsPushedValidationError) {
    return new HttpError(
      400,
      apiErrorCodes.badRequest,
      "IPFS pushed-state request is invalid",
    );
  }
  return error;
}
