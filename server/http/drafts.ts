import type { RequestHandler } from "express";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  createDraftRequestSchema,
  createDraftResponseSchema,
  listDraftsQuerySchema,
  listDraftsResponseSchema,
  type CreateDraftResponse,
  type ListDraftsResponse,
} from "../../shared/drafts.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import { DRAFT_SELF_SERVICE_ACCESS } from "../drafts/access.js";
import {
  DraftInputValidationError,
} from "../drafts/create.js";
import { projectDraftForAuthorizedContext } from "../drafts/projection.js";
import type { DraftRecord } from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const DRAFTS_PATH = "/api/drafts";

export interface DraftCreateHandlerDependencies {
  create(
    context: AuthorizedRequestContext,
    input: unknown,
  ): Promise<DraftRecord>;
  logger: AppLogger;
}

export interface RegisterDraftCreateRouteOptions
  extends DraftCreateHandlerDependencies {
  authorization: AuthorizationGuards;
}

export interface DraftListHandlerDependencies {
  list(
    context: AuthorizedRequestContext,
    query: unknown,
  ): Promise<readonly DraftRecord[]>;
  logger: AppLogger;
}

export interface RegisterDraftListRouteOptions
  extends DraftListHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createDraftCreateHandler(
  dependencies: DraftCreateHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const input = createDraftRequestSchema.parse(req.body);
    let record: DraftRecord;
    try {
      record = await dependencies.create(context, input);
    } catch (error) {
      if (error instanceof DraftInputValidationError) {
        throw new HttpError(
          400,
          apiErrorCodes.validation,
          "Request validation failed",
          error.details,
        );
      }
      throw error;
    }

    const draft = projectAuthorizedFields(
      res,
      record,
      projectDraftForAuthorizedContext,
    );
    if (draft === null) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }
    const response: CreateDraftResponse = createDraftResponseSchema.parse({
      draft,
    });
    dependencies.logger.info("Draft created", {
      component: "drafts",
      draftId: response.draft.id,
      event: "draft_created",
      userId: context.principal.userId,
    });
    res.status(201).set("Cache-Control", "no-store").json(response);
  });
}

export function registerDraftCreateRoute(
  routes: RouteRegistrar,
  options: RegisterDraftCreateRouteOptions,
): void {
  routes.post(
    DRAFTS_PATH,
    {
      authorization: options.authorization.require(DRAFT_SELF_SERVICE_ACCESS),
    },
    createDraftCreateHandler(options),
  );
}

export function createDraftListHandler(
  dependencies: DraftListHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const query = listDraftsQuerySchema.parse(req.query);
    const records = await dependencies.list(context, query);
    const projected = records.map((record) =>
      projectAuthorizedFields(res, record, projectDraftForAuthorizedContext),
    );
    if (projected.some((draft) => draft === null)) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }
    const response: ListDraftsResponse = listDraftsResponseSchema.parse({
      drafts: projected,
    });
    dependencies.logger.info("Own drafts loaded", {
      component: "drafts",
      count: response.drafts.length,
      event: "own_drafts_read",
      status: query.status ?? "all",
      userId: context.principal.userId,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerDraftListRoute(
  routes: RouteRegistrar,
  options: RegisterDraftListRouteOptions,
): void {
  routes.get(
    DRAFTS_PATH,
    {
      authorization: options.authorization.require(DRAFT_SELF_SERVICE_ACCESS),
    },
    createDraftListHandler(options),
  );
}
