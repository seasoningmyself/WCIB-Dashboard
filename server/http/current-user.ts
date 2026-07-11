import type { RequestHandler } from "express";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  AUTHENTICATED_ACCESS,
  getAuthorizedRequestContext,
  type AuthorizationGuards,
} from "../auth/authorization.js";
import {
  projectCurrentUser,
  type CurrentUserIdentity,
} from "../auth/current-user.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const CURRENT_USER_PATH = "/api/me";

export interface CurrentUserHandlerDependencies {
  loadIdentity(userId: string): Promise<CurrentUserIdentity | null>;
}

export interface RegisterCurrentUserRouteOptions {
  authorization: AuthorizationGuards;
  loadIdentity(userId: string): Promise<CurrentUserIdentity | null>;
}

export function createCurrentUserHandler(
  dependencies: CurrentUserHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (_req, res) => {
    const { principal } = getAuthorizedRequestContext(res);
    const identity = await dependencies.loadIdentity(principal.userId);
    if (identity === null) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }

    const response = projectAuthorizedFields(
      res,
      identity,
      projectCurrentUser,
    );
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerCurrentUserRoute(
  routes: RouteRegistrar,
  options: RegisterCurrentUserRouteOptions,
): void {
  routes.get(
    CURRENT_USER_PATH,
    {
      authorization: options.authorization.require(AUTHENTICATED_ACCESS),
    },
    createCurrentUserHandler(options),
  );
}
