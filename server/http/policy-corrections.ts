import type { RequestHandler } from "express";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  policyLedgerCorrectionRequestSchema,
  policyLedgerCorrectionResponseSchema,
} from "../../shared/policy-corrections.js";
import { policyLedgerParamsSchema } from "../../shared/policy-ledger.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import type { AppLogger } from "../logging/logger.js";
import {
  PolicyLedgerCorrectionNotFoundError,
  PolicyLedgerCorrectionStaleError,
  PolicyLedgerCorrectionValidationError,
  type PolicyLedgerCorrectionResult,
} from "../policies/ledger-corrections.js";
import { POLICY_LEDGER_ADMIN_ACCESS } from "../policies/ledger-access.js";
import { projectAdminPolicy } from "../policies/projection.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const POLICY_LEDGER_CORRECTION_PATH =
  "/api/policies/:policyId/correction";

export interface PolicyLedgerCorrectionHandlerDependencies {
  correct(
    context: AuthorizedRequestContext,
    policyId: string,
    input: unknown,
  ): Promise<PolicyLedgerCorrectionResult>;
  logger: AppLogger;
}

export interface RegisterPolicyLedgerCorrectionRouteOptions
  extends PolicyLedgerCorrectionHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createPolicyLedgerCorrectionHandler(
  dependencies: PolicyLedgerCorrectionHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { policyId } = policyLedgerParamsSchema.parse(req.params);
    const input = policyLedgerCorrectionRequestSchema.parse(req.body);
    let result: PolicyLedgerCorrectionResult;
    try {
      result = await dependencies.correct(context, policyId, input);
    } catch (error) {
      throw mapPolicyLedgerCorrectionError(error);
    }
    const projected = projectAuthorizedFields(
      res,
      result.policy,
      projectAdminPolicy,
    );
    if (projected === null) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }
    const response = policyLedgerCorrectionResponseSchema.parse({
      policy: projected,
    });
    dependencies.logger.info("Policy ledger correction completed", {
      component: "policy_ledger",
      event: "ledger_correction_succeeded",
      kind: result.kind,
      mutationId: result.mutationId,
      policyId,
      userId: context.principal.userId,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerPolicyLedgerCorrectionRoute(
  routes: RouteRegistrar,
  options: RegisterPolicyLedgerCorrectionRouteOptions,
): void {
  routes.patch(
    POLICY_LEDGER_CORRECTION_PATH,
    {
      authorization: options.authorization.require(
        POLICY_LEDGER_ADMIN_ACCESS,
      ),
    },
    createPolicyLedgerCorrectionHandler(options),
  );
}

function mapPolicyLedgerCorrectionError(error: unknown): unknown {
  if (error instanceof PolicyLedgerCorrectionNotFoundError) {
    return new HttpError(404, apiErrorCodes.notFound, "Policy not found");
  }
  if (error instanceof PolicyLedgerCorrectionStaleError) {
    return new HttpError(
      409,
      apiErrorCodes.badRequest,
      "Policy changed; reload before correcting",
    );
  }
  if (error instanceof PolicyLedgerCorrectionValidationError) {
    return new HttpError(
      400,
      apiErrorCodes.badRequest,
      "Policy correction is invalid",
    );
  }
  return error;
}
