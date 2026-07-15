import type { RequestHandler, Response } from "express";
import {
  adminVocabularyManagementResponseSchema,
  adminVocabularyParamsSchema,
  adminVocabularyStateRequestSchema,
  type AdminVocabularyKind,
} from "../../shared/vocabulary.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import type { AppLogger } from "../logging/logger.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import {
  ADMIN_VOCABULARY_ACCESS,
  AdminVocabularyAccessDeniedError,
  AdminVocabularyBoundsError,
  AdminVocabularyInUseError,
  AdminVocabularyNotFoundError,
  projectAdminVocabularyManagementSource,
  type AdminVocabularyManagementSource,
} from "../vocabulary/manage.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const ADMIN_VOCABULARY_PATH = "/api/admin/vocabulary";
export const ADMIN_VOCABULARY_STATE_PATH =
  "/api/admin/vocabulary/:kind/:itemId/state";

export interface AdminVocabularyHandlerDependencies {
  list(
    context: AuthorizedRequestContext,
  ): Promise<AdminVocabularyManagementSource>;
  logger: AppLogger;
  setActive(
    context: AuthorizedRequestContext,
    kind: AdminVocabularyKind,
    itemId: string,
    input: unknown,
  ): Promise<AdminVocabularyManagementSource>;
}

export interface RegisterAdminVocabularyRoutesOptions
  extends AdminVocabularyHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createAdminVocabularyListHandler(
  dependencies: AdminVocabularyHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (_req, res) => {
    const context = getAuthorizedRequestContext(res);
    let source: AdminVocabularyManagementSource;
    try {
      source = await dependencies.list(context);
    } catch (error) {
      throw mapAdminVocabularyError(error);
    }
    const response = projectVocabularyResponse(res, source);
    dependencies.logger.info("Vocabulary management loaded", {
      actorUserId: context.principal.userId,
      carrierCount: response.carriers.length,
      component: "admin_vocabulary",
      event: "admin_vocabulary_read",
      mgaCount: response.mgas.length,
      policyTypeCount: response.policyTypes.length,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function createAdminVocabularyStateHandler(
  dependencies: AdminVocabularyHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { itemId, kind } = adminVocabularyParamsSchema.parse(req.params);
    const input = adminVocabularyStateRequestSchema.parse(req.body);
    let source: AdminVocabularyManagementSource;
    try {
      source = await dependencies.setActive(context, kind, itemId, input);
    } catch (error) {
      throw mapAdminVocabularyError(error);
    }
    res
      .set("Cache-Control", "no-store")
      .json(projectVocabularyResponse(res, source));
  });
}

export function registerAdminVocabularyRoutes(
  routes: RouteRegistrar,
  options: RegisterAdminVocabularyRoutesOptions,
): void {
  const access = {
    authorization: options.authorization.require(ADMIN_VOCABULARY_ACCESS),
  } as const;
  routes.get(
    ADMIN_VOCABULARY_PATH,
    access,
    createAdminVocabularyListHandler(options),
  );
  routes.put(
    ADMIN_VOCABULARY_STATE_PATH,
    access,
    createAdminVocabularyStateHandler(options),
  );
}

function projectVocabularyResponse(
  response: Response,
  source: AdminVocabularyManagementSource,
) {
  const projected = projectAuthorizedFields(
    response,
    source,
    projectAdminVocabularyManagementSource,
  );
  if (projected === null) {
    throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  return adminVocabularyManagementResponseSchema.parse(projected);
}

function mapAdminVocabularyError(error: unknown): unknown {
  if (error instanceof AdminVocabularyAccessDeniedError) {
    return new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  if (error instanceof AdminVocabularyNotFoundError) {
    return new HttpError(
      404,
      apiErrorCodes.notFound,
      "Vocabulary entry was not found",
    );
  }
  if (error instanceof AdminVocabularyInUseError) {
    return new HttpError(
      409,
      apiErrorCodes.badRequest,
      "Vocabulary entry is in use and cannot be deactivated",
    );
  }
  if (error instanceof AdminVocabularyBoundsError) {
    return new HttpError(
      409,
      apiErrorCodes.badRequest,
      "Vocabulary result is too large",
    );
  }
  return error;
}
