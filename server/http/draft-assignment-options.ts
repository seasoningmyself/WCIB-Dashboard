import type { RequestHandler } from "express";
import { draftAssignmentOptionsResponseSchema } from "../../shared/draft-assignment-options.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
} from "../auth/authorization.js";
import { DRAFT_SELF_SERVICE_ACCESS } from "../drafts/access.js";
import { projectDraftAssignmentOptions } from "../drafts/assignment-options.js";
import type { DraftAssignmentOption } from "../../shared/draft-assignment-options.js";
import type { AppLogger } from "../logging/logger.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const DRAFT_ASSIGNMENT_OPTIONS_PATH = "/api/draft-assignment-options";

export interface DraftAssignmentOptionsHandlerDependencies {
  list(): Promise<readonly DraftAssignmentOption[]>;
  logger: AppLogger;
}

export function createDraftAssignmentOptionsHandler(
  dependencies: DraftAssignmentOptionsHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (_req, res) => {
    const context = getAuthorizedRequestContext(res);
    const records = await dependencies.list();
    const projected = projectAuthorizedFields(
      res,
      records,
      projectDraftAssignmentOptions,
    );
    if (projected === null) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }
    const response = draftAssignmentOptionsResponseSchema.parse(projected);
    dependencies.logger.info("Draft assignment options loaded", {
      component: "drafts",
      count: response.producers.length,
      event: "draft_assignment_options_read",
      userId: context.principal.userId,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerDraftAssignmentOptionsRoute(
  routes: RouteRegistrar,
  options: DraftAssignmentOptionsHandlerDependencies & {
    authorization: AuthorizationGuards;
  },
): void {
  routes.get(
    DRAFT_ASSIGNMENT_OPTIONS_PATH,
    {
      authorization: options.authorization.require(DRAFT_SELF_SERVICE_ACCESS),
    },
    createDraftAssignmentOptionsHandler(options),
  );
}
