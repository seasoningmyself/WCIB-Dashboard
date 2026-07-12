import type { RequestHandler, Response } from "express";
import {
  kpiActualQuerySchema,
  kpiActualResponseSchema,
} from "../../shared/kpi-actuals.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import {
  KpiActualBoundsError,
  KpiActualConsistencyError,
  KpiActualProducerNotFoundError,
  projectAdminKpiActualSource,
  type KpiActualSource,
} from "../kpi/actuals.js";
import {
  KPI_ADMIN_ACCESS,
  KpiTargetAccessDeniedError,
} from "../kpi/targets.js";
import type { AppLogger } from "../logging/logger.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const KPI_ACTUALS_PATH = "/api/kpi-actuals";

export interface KpiActualHandlerDependencies {
  list(
    context: AuthorizedRequestContext,
    query: unknown,
  ): Promise<KpiActualSource>;
  logger: AppLogger;
}

export interface RegisterKpiActualRouteOptions
  extends KpiActualHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createKpiActualHandler(
  dependencies: KpiActualHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const query = kpiActualQuerySchema.parse(req.query);
    let source: KpiActualSource;
    try {
      source = await dependencies.list(context, query);
    } catch (error) {
      throw mapKpiActualError(error);
    }
    const response = projectKpiActualResponse(res, source);
    dependencies.logger.info("KPI actuals loaded", {
      actorUserId: context.principal.userId,
      agencyFactCount: source.agencyFactCount,
      component: "kpi_actuals",
      event: "kpi_actuals_loaded",
      payoutFactCount: source.payoutFactCount,
      period: query.period,
      producerUserId: query.producerUserId ?? null,
      scopeType: query.scopeType,
      year: query.year,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerKpiActualRoute(
  routes: RouteRegistrar,
  options: RegisterKpiActualRouteOptions,
): void {
  routes.get(
    KPI_ACTUALS_PATH,
    { authorization: options.authorization.require(KPI_ADMIN_ACCESS) },
    createKpiActualHandler(options),
  );
}

function projectKpiActualResponse(
  response: Response,
  source: KpiActualSource,
) {
  const projected = projectAuthorizedFields(
    response,
    source,
    projectAdminKpiActualSource,
  );
  if (projected === null) {
    throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  return kpiActualResponseSchema.parse(projected);
}

function mapKpiActualError(error: unknown): unknown {
  if (error instanceof KpiTargetAccessDeniedError) {
    return new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  if (error instanceof KpiActualProducerNotFoundError) {
    return new HttpError(404, apiErrorCodes.notFound, "KPI producer was not found");
  }
  if (error instanceof KpiActualBoundsError) {
    return new HttpError(409, apiErrorCodes.badRequest, "KPI actual result is too large");
  }
  if (error instanceof KpiActualConsistencyError) {
    return new HttpError(409, apiErrorCodes.badRequest, "Closed KPI facts are inconsistent");
  }
  return error;
}
