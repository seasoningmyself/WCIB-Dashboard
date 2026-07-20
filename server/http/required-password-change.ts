import type { RequestHandler } from "express";
import { requiredPasswordChangeRequestSchema } from "../../shared/account-settings.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  AUTHENTICATED_ACCESS,
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import {
  PasswordChangeNotRequiredError,
  PasswordReuseError,
} from "../auth/password-changes.js";
import type { UserAccount } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const REQUIRED_PASSWORD_CHANGE_PATH =
  "/api/auth/required-password-change";

export interface RequiredPasswordChangeHandlerDependencies {
  change(
    context: AuthorizedRequestContext,
    input: unknown,
  ): Promise<UserAccount>;
  establishSession(
    req: Parameters<RequestHandler>[0],
    user: UserAccount,
  ): Promise<void>;
  logger: AppLogger;
}

export interface RegisterRequiredPasswordChangeRouteOptions
  extends RequiredPasswordChangeHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createRequiredPasswordChangeHandler(
  dependencies: RequiredPasswordChangeHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const input = requiredPasswordChangeRequestSchema.parse(req.body);
    let user: UserAccount;
    try {
      user = await dependencies.change(context, input);
    } catch (error) {
      if (error instanceof PasswordReuseError) {
        throw new HttpError(409, apiErrorCodes.passwordReuse, error.message);
      }
      if (error instanceof PasswordChangeNotRequiredError) {
        throw new HttpError(409, apiErrorCodes.badRequest, error.message);
      }
      throw error;
    }
    await dependencies.establishSession(req, user);
    dependencies.logger.info("Required password change completed", {
      component: "auth",
      event: "required_password_change_completed",
      userId: user.id,
    });
    res.status(204).end();
  });
}

export function registerRequiredPasswordChangeRoute(
  routes: RouteRegistrar,
  options: RegisterRequiredPasswordChangeRouteOptions,
): void {
  routes.post(
    REQUIRED_PASSWORD_CHANGE_PATH,
    {
      authorization: options.authorization.require(AUTHENTICATED_ACCESS, {
        allowPasswordChangeRequired: true,
      }),
    },
    createRequiredPasswordChangeHandler({
      ...options,
    }),
  );
}
