import type { RequestHandler, Response } from "express";
import {
  mgaPayableGroupParamsSchema,
  mgaPayableGroupStateRequestSchema,
  mgaPayableGroupStateResponseSchema,
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
  MgaPayableBoundsError,
  MgaPayableNotFoundError,
  type MgaPayableSourceItem,
} from "../policies/mga-payables.js";
import type { MgaPayableGroupStateChangeResult } from "../policies/mga-payable-group-state.js";
import {
  MgaPayableStateConflictError,
  MgaPayableStateValidationError,
} from "../policies/mga-payable-state.js";
import { asyncRoute, HttpError } from "./errors.js";
import { projectMgaPayableForResponse } from "./mga-payable-state.js";
import type { RouteRegistrar } from "./routes.js";

export const MGA_PAYABLE_GROUP_STATE_PATH =
  "/api/mga-payables/groups/:mgaId/state";

export interface MgaPayableGroupStateHandlerDependencies {
  change(
    context: AuthorizedRequestContext,
    mgaId: string,
    input: unknown,
  ): Promise<MgaPayableGroupStateChangeResult>;
  logger: AppLogger;
}

export interface RegisterMgaPayableGroupStateRouteOptions
  extends MgaPayableGroupStateHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createMgaPayableGroupStateHandler(
  dependencies: MgaPayableGroupStateHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { mgaId } = mgaPayableGroupParamsSchema.parse(req.params);
    const input = mgaPayableGroupStateRequestSchema.parse(req.body);
    let changed: MgaPayableGroupStateChangeResult;
    try {
      changed = await dependencies.change(context, mgaId, input);
    } catch (error) {
      throw mapGroupStateHttpError(error);
    }
    const results = changed.results.map(({ placement, source }) => ({
      item: projectGroupItem(res, source),
      placement,
    }));
    const response = mgaPayableGroupStateResponseSchema.parse({
      changedCount: results.length,
      results,
      status: changed.status,
    });
    dependencies.logger.info("MGA payable group state returned", {
      actorUserId: context.principal.userId,
      changedCount: response.changedCount,
      component: "mga_payables",
      event: "mga_payable_group_state_response",
      mgaId,
      status: response.status,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerMgaPayableGroupStateRoute(
  routes: RouteRegistrar,
  options: RegisterMgaPayableGroupStateRouteOptions,
): void {
  routes.put(
    MGA_PAYABLE_GROUP_STATE_PATH,
    {
      authorization: options.authorization.require(
        POLICY_LEDGER_ADMIN_ACCESS,
      ),
    },
    createMgaPayableGroupStateHandler(options),
  );
}

function projectGroupItem(
  res: Response,
  source: MgaPayableSourceItem,
): MgaPayableItem {
  return projectMgaPayableForResponse(res, source);
}

function mapGroupStateHttpError(error: unknown): unknown {
  if (error instanceof MgaPayableNotFoundError) {
    return new HttpError(
      404,
      apiErrorCodes.notFound,
      "MGA payable group was not found",
    );
  }
  if (error instanceof MgaPayableBoundsError) {
    return new HttpError(
      409,
      apiErrorCodes.badRequest,
      "MGA payable group exceeds the supported size",
    );
  }
  if (error instanceof MgaPayableStateConflictError) {
    return new HttpError(
      409,
      apiErrorCodes.badRequest,
      "MGA payable group state cannot be changed",
    );
  }
  if (error instanceof MgaPayableStateValidationError) {
    return new HttpError(
      400,
      apiErrorCodes.badRequest,
      "MGA payable group state request is invalid",
    );
  }
  return error;
}
