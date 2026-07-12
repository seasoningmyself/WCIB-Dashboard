import type { RequestHandler, Response } from "express";
import {
  kpiTargetListQuerySchema,
  kpiTargetListResponseSchema,
  kpiTargetMutationRequestSchema,
  kpiTargetMutationResponseSchema,
  kpiTargetParamsSchema,
} from "../../shared/kpi-target-api.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import {
  KPI_ADMIN_ACCESS,
  KpiTargetAccessDeniedError,
  KpiTargetBoundsError,
  KpiTargetProducerNotFoundError,
  KpiTargetWriteConflictError,
  projectAdminKpiTargetListSource,
  projectAdminKpiTargetMutationSource,
  type KpiTargetListSource,
  type KpiTargetMutationSource,
} from "../kpi/targets.js";
import type { AppLogger } from "../logging/logger.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const KPI_TARGETS_PATH = "/api/kpi-targets";
export const KPI_TARGET_PATH = "/api/kpi-targets/:scopeType/:year";

export interface KpiTargetHandlerDependencies {
  list(
    context: AuthorizedRequestContext,
    query: unknown,
  ): Promise<KpiTargetListSource>;
  logger: AppLogger;
  upsert(
    context: AuthorizedRequestContext,
    scopeType: "company" | "producer",
    year: number,
    input: unknown,
  ): Promise<KpiTargetMutationSource>;
}

export interface RegisterKpiTargetRoutesOptions
  extends KpiTargetHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createKpiTargetListHandler(
  dependencies: KpiTargetHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const query = kpiTargetListQuerySchema.parse(req.query);
    let source: KpiTargetListSource;
    try {
      source = await dependencies.list(context, query);
    } catch (error) {
      throw mapKpiTargetError(error);
    }
    const response = projectKpiTargetList(res, source);
    dependencies.logger.info("KPI targets loaded", {
      actorUserId: context.principal.userId,
      component: "kpi_targets",
      event: "kpi_targets_loaded",
      producerUserId: query.producerUserId ?? null,
      resultCount: response.items.length,
      scopeType: query.scopeType ?? "all",
      year: query.year,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function createKpiTargetUpsertHandler(
  dependencies: KpiTargetHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { scopeType, year } = kpiTargetParamsSchema.parse(req.params);
    const input = kpiTargetMutationRequestSchema.parse(req.body);
    if (
      (scopeType === "company" && input.producerUserId !== null) ||
      (scopeType === "producer" && input.producerUserId === null)
    ) {
      throw new HttpError(400, apiErrorCodes.badRequest, "KPI target scope is invalid");
    }
    let source: KpiTargetMutationSource;
    try {
      source = await dependencies.upsert(context, scopeType, year, input);
    } catch (error) {
      throw mapKpiTargetError(error);
    }
    res
      .set("Cache-Control", "no-store")
      .json(projectKpiTargetMutation(res, source));
  });
}

export function registerKpiTargetRoutes(
  routes: RouteRegistrar,
  options: RegisterKpiTargetRoutesOptions,
): void {
  const access = {
    authorization: options.authorization.require(KPI_ADMIN_ACCESS),
  } as const;
  routes.get(KPI_TARGETS_PATH, access, createKpiTargetListHandler(options));
  routes.put(KPI_TARGET_PATH, access, createKpiTargetUpsertHandler(options));
}

function projectKpiTargetList(
  response: Response,
  source: KpiTargetListSource,
) {
  const projected = projectAuthorizedFields(
    response,
    source,
    projectAdminKpiTargetListSource,
  );
  if (projected === null) {
    throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  return kpiTargetListResponseSchema.parse(projected);
}

function projectKpiTargetMutation(
  response: Response,
  source: KpiTargetMutationSource,
) {
  const projected = projectAuthorizedFields(
    response,
    source,
    projectAdminKpiTargetMutationSource,
  );
  if (projected === null) {
    throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  return kpiTargetMutationResponseSchema.parse(projected);
}

function mapKpiTargetError(error: unknown): unknown {
  if (error instanceof KpiTargetAccessDeniedError) {
    return new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  if (error instanceof KpiTargetProducerNotFoundError) {
    return new HttpError(404, apiErrorCodes.notFound, "KPI producer was not found");
  }
  if (error instanceof KpiTargetBoundsError) {
    return new HttpError(409, apiErrorCodes.badRequest, "KPI target result is too large");
  }
  if (error instanceof KpiTargetWriteConflictError) {
    return new HttpError(409, apiErrorCodes.badRequest, "KPI target conflicts with current data");
  }
  return error;
}
