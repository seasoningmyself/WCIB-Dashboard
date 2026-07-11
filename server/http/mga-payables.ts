import type { RequestHandler, Response } from "express";
import {
  mgaPayableListQuerySchema,
  mgaPayableListResponseSchema,
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
  buildMgaPayableListResponse,
  projectAdminMgaPayable,
  type MgaPayableSourceItem,
  type MgaPayableSourceList,
} from "../policies/mga-payables.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const MGA_PAYABLES_PATH = "/api/mga-payables";

export interface MgaPayableHandlerDependencies {
  list(
    context: AuthorizedRequestContext,
    query: unknown,
  ): Promise<MgaPayableSourceList>;
  logger: AppLogger;
}

export interface RegisterMgaPayableRouteOptions
  extends MgaPayableHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createMgaPayableListHandler(
  dependencies: MgaPayableHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const query = mgaPayableListQuerySchema.parse(req.query);
    let source: MgaPayableSourceList;
    try {
      source = await dependencies.list(context, query);
    } catch (error) {
      if (error instanceof MgaPayableBoundsError) {
        throw new HttpError(
          400,
          apiErrorCodes.badRequest,
          "MGA payable query is invalid",
        );
      }
      throw error;
    }
    const items = source.items.map((item) => projectPayable(res, item));
    const response = mgaPayableListResponseSchema.parse(
      buildMgaPayableListResponse(items, source.status),
    );
    dependencies.logger.info("MGA payables loaded", {
      component: "mga_payables",
      event: "mga_payables_read",
      groupCount: response.groups.length,
      resultCount: response.groups.reduce(
        (count, group) => count + group.items.length,
        0,
      ),
      status: response.status,
      userId: context.principal.userId,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerMgaPayableRoute(
  routes: RouteRegistrar,
  options: RegisterMgaPayableRouteOptions,
): void {
  routes.get(
    MGA_PAYABLES_PATH,
    {
      authorization: options.authorization.require(
        POLICY_LEDGER_ADMIN_ACCESS,
      ),
    },
    createMgaPayableListHandler(options),
  );
}

function projectPayable(
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
