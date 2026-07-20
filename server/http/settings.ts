import type { Request, RequestHandler } from "express";
import {
  changeOwnPasswordRequestSchema,
  updateOwnProfileRequestSchema,
} from "../../shared/account-settings.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  AUTHENTICATED_ACCESS,
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import {
  InvalidCurrentPasswordError,
  PasswordReuseError,
} from "../auth/password-changes.js";
import {
  OwnSettingsConflictError,
  OwnSettingsNotFoundError,
  projectOwnSettings,
  type OwnSettingsSource,
} from "../auth/settings.js";
import type { UserAccount } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const OWN_SETTINGS_PATH = "/api/settings/me";
export const OWN_SETTINGS_PROFILE_PATH = "/api/settings/me/profile";
export const OWN_SETTINGS_PASSWORD_PATH = "/api/settings/me/password";

export interface SettingsHandlerDependencies {
  changePassword(
    context: AuthorizedRequestContext,
    input: unknown,
  ): Promise<UserAccount>;
  establishSession(req: Request, user: UserAccount): Promise<void>;
  load(context: AuthorizedRequestContext): Promise<OwnSettingsSource>;
  logger: AppLogger;
  updateProfile(
    context: AuthorizedRequestContext,
    input: unknown,
  ): Promise<OwnSettingsSource>;
}

export interface RegisterSettingsRoutesOptions
  extends SettingsHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createOwnSettingsReadHandler(
  dependencies: SettingsHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (_req, res) => {
    const context = getAuthorizedRequestContext(res);
    const source = await loadOrMapNotFound(dependencies, context);
    const response = projectAuthorizedFields(res, source, projectOwnSettings);
    if (response === null) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function createOwnProfileUpdateHandler(
  dependencies: SettingsHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const input = updateOwnProfileRequestSchema.parse(req.body);
    let source: OwnSettingsSource;
    try {
      source = await dependencies.updateProfile(context, input);
    } catch (error) {
      if (error instanceof OwnSettingsConflictError) {
        throw new HttpError(409, apiErrorCodes.badRequest, error.message);
      }
      if (error instanceof OwnSettingsNotFoundError) {
        throw new HttpError(404, apiErrorCodes.notFound, error.message);
      }
      throw error;
    }
    const response = projectAuthorizedFields(res, source, projectOwnSettings);
    if (response === null) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function createOwnPasswordChangeHandler(
  dependencies: SettingsHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const input = changeOwnPasswordRequestSchema.parse(req.body);
    let user: UserAccount;
    try {
      user = await dependencies.changePassword(context, input);
    } catch (error) {
      if (error instanceof InvalidCurrentPasswordError) {
        throw new HttpError(
          400,
          apiErrorCodes.invalidCurrentPassword,
          error.message,
        );
      }
      if (error instanceof PasswordReuseError) {
        throw new HttpError(409, apiErrorCodes.passwordReuse, error.message);
      }
      throw error;
    }
    await dependencies.establishSession(req, user);
    dependencies.logger.info("Account password changed", {
      component: "settings",
      event: "account_password_changed",
      userId: user.id,
    });
    res.status(204).end();
  });
}

export function registerSettingsRoutes(
  routes: RouteRegistrar,
  options: RegisterSettingsRoutesOptions,
): void {
  const access = {
    authorization: options.authorization.require(AUTHENTICATED_ACCESS),
  } as const;
  routes.get(OWN_SETTINGS_PATH, access, createOwnSettingsReadHandler(options));
  routes.patch(
    OWN_SETTINGS_PROFILE_PATH,
    access,
    createOwnProfileUpdateHandler(options),
  );
  routes.post(
    OWN_SETTINGS_PASSWORD_PATH,
    access,
    createOwnPasswordChangeHandler(options),
  );
}

async function loadOrMapNotFound(
  dependencies: SettingsHandlerDependencies,
  context: AuthorizedRequestContext,
): Promise<OwnSettingsSource> {
  try {
    return await dependencies.load(context);
  } catch (error) {
    if (error instanceof OwnSettingsNotFoundError) {
      throw new HttpError(404, apiErrorCodes.notFound, error.message);
    }
    throw error;
  }
}
