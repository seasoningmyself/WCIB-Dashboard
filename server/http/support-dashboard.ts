import type { RequestHandler } from "express";
import { operationalSupportDashboardSchema } from "../../shared/support-dashboard.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import {
  projectOperationalSupportDashboard,
  SUPPORT_DASHBOARD_ACCESS,
  SupportDashboardAccessDeniedError,
  SupportDashboardBoundsError,
} from "../support/operational.js";
import type { OperationalSupportDashboard } from "../../shared/support-dashboard.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const SUPPORT_DASHBOARD_PATH = "/api/support/dashboard";

export interface SupportDashboardHandlerDependencies {
  load(
    context: AuthorizedRequestContext,
  ): Promise<OperationalSupportDashboard>;
}

export interface RegisterSupportDashboardRoutesOptions
  extends SupportDashboardHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createSupportDashboardHandler(
  dependencies: SupportDashboardHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (_req, res) => {
    const context = getAuthorizedRequestContext(res);
    let source: OperationalSupportDashboard;
    try {
      source = await dependencies.load(context);
    } catch (error) {
      if (error instanceof SupportDashboardAccessDeniedError) {
        throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
      }
      if (error instanceof SupportDashboardBoundsError) {
        throw new HttpError(
          409,
          apiErrorCodes.badRequest,
          "Support dashboard result is too large",
        );
      }
      throw error;
    }
    const projected = projectAuthorizedFields(
      res,
      source,
      projectOperationalSupportDashboard,
    );
    if (projected === null) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }
    res
      .set("Cache-Control", "no-store")
      .json(operationalSupportDashboardSchema.parse(projected));
  });
}

export function registerSupportDashboardRoutes(
  routes: RouteRegistrar,
  options: RegisterSupportDashboardRoutesOptions,
): void {
  routes.get(
    SUPPORT_DASHBOARD_PATH,
    {
      authorization: options.authorization.require(SUPPORT_DASHBOARD_ACCESS),
    },
    createSupportDashboardHandler(options),
  );
}
