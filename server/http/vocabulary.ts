import type { RequestHandler } from "express";
import { apiErrorCodes } from "../../shared/api-errors.js";
import { activeVocabularyResponseSchema } from "../../shared/vocabulary.js";
import type { AuthorizationGuards } from "../auth/authorization.js";
import type { AppLogger } from "../logging/logger.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import {
  projectActiveVocabulary,
  VOCABULARY_READ_ACCESS,
  type ActiveVocabularySource,
} from "../vocabulary/active.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const ACTIVE_VOCABULARY_PATH = "/api/vocabulary";

export interface ActiveVocabularyHandlerDependencies {
  load(): Promise<ActiveVocabularySource>;
  logger: AppLogger;
}

export interface RegisterActiveVocabularyRouteOptions {
  authorization: AuthorizationGuards;
  load(): Promise<ActiveVocabularySource>;
  logger: AppLogger;
}

export function createActiveVocabularyHandler(
  dependencies: ActiveVocabularyHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (_req, res) => {
    const source = await dependencies.load();
    const projected = projectAuthorizedFields(
      res,
      source,
      projectActiveVocabulary,
    );
    if (projected === null) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }

    const response = activeVocabularyResponseSchema.parse(projected);
    dependencies.logger.info("Active vocabulary loaded", {
      carrierCount: response.carriers.length,
      component: "vocabulary",
      event: "active_vocabulary_read",
      mgaCount: response.mgas.length,
      officeLocationCount: response.officeLocations.length,
      policyTypeCount: response.policyTypes.length,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerActiveVocabularyRoute(
  routes: RouteRegistrar,
  options: RegisterActiveVocabularyRouteOptions,
): void {
  routes.get(
    ACTIVE_VOCABULARY_PATH,
    {
      authorization: options.authorization.require(VOCABULARY_READ_ACCESS),
    },
    createActiveVocabularyHandler({
      load: options.load,
      logger: options.logger,
    }),
  );
}
