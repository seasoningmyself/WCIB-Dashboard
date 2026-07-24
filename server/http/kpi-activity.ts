import type { RequestHandler, Response } from "express";
import {
  kpiRecentActivityResponseSchema,
} from "../../shared/kpi-activity.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import {
  projectAdminKpiRecentActivitySource,
  type KpiRecentActivitySource,
} from "../kpi/activity.js";
import {
  KPI_ADMIN_ACCESS,
  KpiTargetAccessDeniedError,
} from "../kpi/targets.js";
import type { AppLogger } from "../logging/logger.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const KPI_RECENT_ACTIVITY_PATH = "/api/kpi-activity";

export interface KpiRecentActivityHandlerDependencies {
  list(context: AuthorizedRequestContext): Promise<KpiRecentActivitySource>;
  logger: AppLogger;
}

export interface RegisterKpiRecentActivityRouteOptions
  extends KpiRecentActivityHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createKpiRecentActivityHandler(
  dependencies: KpiRecentActivityHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (_request, response) => {
    const context = getAuthorizedRequestContext(response);
    let source: KpiRecentActivitySource;
    try {
      source = await dependencies.list(context);
    } catch (error) {
      if (error instanceof KpiTargetAccessDeniedError) {
        throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
      }
      throw error;
    }
    const projected = projectKpiRecentActivityResponse(response, source);
    dependencies.logger.info("KPI recent activity loaded", {
      actorUserId: context.principal.userId,
      component: "kpi_activity",
      event: "kpi_activity_loaded",
      resultCount: projected.activities.length,
    });
    response.set("Cache-Control", "no-store").json(projected);
  });
}

export function registerKpiRecentActivityRoute(
  routes: RouteRegistrar,
  options: RegisterKpiRecentActivityRouteOptions,
): void {
  routes.get(
    KPI_RECENT_ACTIVITY_PATH,
    { authorization: options.authorization.require(KPI_ADMIN_ACCESS) },
    createKpiRecentActivityHandler(options),
  );
}

function projectKpiRecentActivityResponse(
  response: Response,
  source: KpiRecentActivitySource,
) {
  const projected = projectAuthorizedFields(
    response,
    source,
    projectAdminKpiRecentActivitySource,
  );
  if (projected === null) {
    throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  return kpiRecentActivityResponseSchema.parse(projected);
}
