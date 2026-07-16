import type { RequestHandler, Response } from "express";
import {
  mgaPayableParamsSchema,
  mgaPayableStateRequestSchema,
  mgaPayableStateResponseSchema,
  type MgaPayableItem,
} from "../../shared/mga-payables.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import type { AppLogger } from "../logging/logger.js";
import { POLICY_LEDGER_ADMIN_ACCESS } from "../policies/ledger-access.js";
import {
  projectAdminMgaPayable,
  type MgaPayableSourceItem,
} from "../policies/mga-payables.js";
import {
  MgaPayableStateConflictError,
  MgaPayableStateValidationError,
  type MgaPayableStateChangeResult,
} from "../policies/mga-payable-state.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const MGA_PAYABLE_STATE_PATH = "/api/mga-payables/:policyId/state";

export interface MgaPayableStateHandlerDependencies {
  change(
    context: AuthorizedRequestContext,
    policyId: string,
    input: unknown,
  ): Promise<MgaPayableStateChangeResult>;
  logger: AppLogger;
}

export interface RegisterMgaPayableStateRouteOptions
  extends MgaPayableStateHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createMgaPayableStateHandler(
  dependencies: MgaPayableStateHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { policyId } = mgaPayableParamsSchema.parse(req.params);
    const input = mgaPayableStateRequestSchema.parse(req.body);
    let changed: MgaPayableStateChangeResult;
    try {
      changed = await dependencies.change(context, policyId, input);
    } catch (error) {
      throw mapMgaPayableStateHttpError(error);
    }
    const response = mgaPayableStateResponseSchema.parse({
      item: projectMgaPayableForResponse(res, changed.source),
      placement: changed.placement,
    });
    dependencies.logger.info("MGA payable state returned", {
      actorUserId: context.principal.userId,
      associationCount: response.placement.associationCount,
      component: "mga_payables",
      event: "mga_payable_state_response",
      policyId,
      status: response.item.status,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerMgaPayableStateRoute(
  routes: RouteRegistrar,
  options: RegisterMgaPayableStateRouteOptions,
): void {
  routes.put(
    MGA_PAYABLE_STATE_PATH,
    {
      authorization: options.authorization.require(
        POLICY_LEDGER_ADMIN_ACCESS,
      ),
    },
    createMgaPayableStateHandler(options),
  );
}

export function projectMgaPayableForResponse(
  res: Response,
  source: MgaPayableSourceItem,
): MgaPayableItem {
  const projected = projectAuthorizedFields(
    res,
    source,
    projectAdminMgaPayable,
  );
  if (projected === null) {
    throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  return projected;
}

function mapMgaPayableStateHttpError(error: unknown): unknown {
  if (error instanceof MgaPayableStateConflictError) {
    return new HttpError(
      409,
      apiErrorCodes.badRequest,
      "MGA payable state cannot be changed",
    );
  }
  if (error instanceof MgaPayableStateValidationError) {
    return new HttpError(
      400,
      apiErrorCodes.badRequest,
      "MGA payable state request is invalid",
    );
  }
  return error;
}
