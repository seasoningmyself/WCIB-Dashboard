import type { RequestHandler, Response } from "express";
import {
  businessStateGenerationParamsSchema,
  businessStateListResponseSchema,
  businessStateTransitionResponseSchema,
  resetBusinessStateRequestSchema,
  restoreBusinessStateRequestSchema,
} from "../../shared/business-state.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import {
  BusinessStateNotFoundError,
  BusinessStateTransitionConflictError,
  BusinessStateValidationError,
  projectAdminBusinessState,
  projectAdminBusinessStateTransition,
  type BusinessStateSource,
  type BusinessStateTransitionSource,
} from "../business-state/service.js";
import type { AppLogger } from "../logging/logger.js";
import { POLICY_LEDGER_ADMIN_ACCESS } from "../policies/ledger-access.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const BUSINESS_STATE_PATH = "/api/admin/business-state";
export const BUSINESS_STATE_RESET_PATH = "/api/admin/business-state/reset";
export const BUSINESS_STATE_RESTORE_PATH =
  "/api/admin/business-state/generations/:generationId/restore";

export interface BusinessStateHandlerDependencies {
  list(context: AuthorizedRequestContext): Promise<BusinessStateSource>;
  logger: AppLogger;
  reset(
    context: AuthorizedRequestContext,
    input: unknown,
  ): Promise<BusinessStateTransitionSource>;
  restore(
    context: AuthorizedRequestContext,
    generationId: string,
    input: unknown,
  ): Promise<BusinessStateTransitionSource>;
}

export interface RegisterBusinessStateRoutesOptions
  extends BusinessStateHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createBusinessStateListHandler(
  dependencies: BusinessStateHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (_req, res) => {
    const context = getAuthorizedRequestContext(res);
    const source = await dependencies.list(context);
    const response = projectList(res, source);
    dependencies.logger.info("Business-state recovery points loaded", {
      actorUserId: context.principal.userId,
      component: "business_state",
      event: "business_state_list_read",
      generationCount: response.generations.length,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function createBusinessStateResetHandler(
  dependencies: BusinessStateHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const input = resetBusinessStateRequestSchema.parse(req.body);
    let source: BusinessStateTransitionSource;
    try {
      source = await dependencies.reset(context, input);
    } catch (error) {
      throw mapBusinessStateError(error);
    }
    const response = projectTransition(res, source);
    dependencies.logger.info("Business state reset completed", {
      activeGenerationId: response.activeGeneration.id,
      actorUserId: context.principal.userId,
      clearKpiTargets: input.clearKpiTargets,
      component: "business_state",
      event: "business_state_reset_completed",
      sealedGenerationId: response.sealedGeneration.id,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function createBusinessStateRestoreHandler(
  dependencies: BusinessStateHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { generationId } = businessStateGenerationParamsSchema.parse(req.params);
    const input = restoreBusinessStateRequestSchema.parse(req.body);
    let source: BusinessStateTransitionSource;
    try {
      source = await dependencies.restore(context, generationId, input);
    } catch (error) {
      throw mapBusinessStateError(error);
    }
    const response = projectTransition(res, source);
    dependencies.logger.info("Business state restored", {
      activeGenerationId: response.activeGeneration.id,
      actorUserId: context.principal.userId,
      component: "business_state",
      event: "business_state_restore_completed",
      sealedGenerationId: response.sealedGeneration.id,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerBusinessStateRoutes(
  routes: RouteRegistrar,
  options: RegisterBusinessStateRoutesOptions,
): void {
  const access = {
    authorization: options.authorization.require(POLICY_LEDGER_ADMIN_ACCESS),
  } as const;
  routes.get(BUSINESS_STATE_PATH, access, createBusinessStateListHandler(options));
  routes.post(
    BUSINESS_STATE_RESET_PATH,
    access,
    createBusinessStateResetHandler(options),
  );
  routes.post(
    BUSINESS_STATE_RESTORE_PATH,
    access,
    createBusinessStateRestoreHandler(options),
  );
}

function projectList(res: Response, source: BusinessStateSource) {
  const projected = projectAuthorizedFields(res, source, projectAdminBusinessState);
  if (projected === null) throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  return businessStateListResponseSchema.parse(projected);
}

function projectTransition(res: Response, source: BusinessStateTransitionSource) {
  const projected = projectAuthorizedFields(
    res,
    source,
    projectAdminBusinessStateTransition,
  );
  if (projected === null) throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  return businessStateTransitionResponseSchema.parse(projected);
}

function mapBusinessStateError(error: unknown): unknown {
  if (error instanceof BusinessStateNotFoundError) {
    return new HttpError(404, apiErrorCodes.notFound, "Recovery point not found");
  }
  if (error instanceof BusinessStateValidationError) {
    return new HttpError(400, apiErrorCodes.badRequest, "Confirmation is invalid");
  }
  if (error instanceof BusinessStateTransitionConflictError) {
    return new HttpError(
      409,
      apiErrorCodes.badRequest,
      "Business state changed or contains work that must be archived first",
    );
  }
  return error;
}
