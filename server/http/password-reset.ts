import type { Express, RequestHandler } from "express";
import {
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  type PasswordResetConfirm,
  type PasswordResetRequest,
  type PasswordResetRequestResponse,
} from "../../shared/password-reset.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  confirmPasswordReset,
  requestPasswordReset,
  type PasswordResetRequestResult,
} from "../auth/password-reset.js";
import {
  unavailablePasswordResetDelivery,
  type PasswordResetDelivery,
} from "../auth/password-reset-delivery.js";
import type { AuthDatabase } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import { SESSION_COOKIE_NAME } from "../auth/sessions.js";
import { asyncRoute, HttpError } from "./errors.js";

export const PASSWORD_RESET_REQUEST_PATH = "/api/auth/password-reset/request";
export const PASSWORD_RESET_CONFIRM_PATH = "/api/auth/password-reset/confirm";

const acceptedResponse: PasswordResetRequestResponse = { status: "accepted" };

export interface PasswordResetRequestHandlerDependencies {
  logger: AppLogger;
  requestReset(request: PasswordResetRequest): Promise<PasswordResetRequestResult>;
}

export interface PasswordResetConfirmHandlerDependencies {
  confirmReset(request: PasswordResetConfirm): Promise<boolean>;
  logger: AppLogger;
}

export interface RegisterPasswordResetRoutesOptions {
  database: AuthDatabase;
  delivery?: PasswordResetDelivery;
  logger: AppLogger;
}

export function createPasswordResetRequestHandler(
  dependencies: PasswordResetRequestHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const request = passwordResetRequestSchema.parse(req.body);

    try {
      const result = await dependencies.requestReset(request);
      if (result.status === "delivery_failed") {
        dependencies.logger.warn(
          "Password reset delivery failed",
          { component: "auth", event: "password_reset_delivery_failed" },
        );
      }
    } catch (error) {
      dependencies.logger.error(
        "Password reset request failed",
        { component: "auth", event: "password_reset_request_failed" },
        error,
      );
    }

    dependencies.logger.info("Password reset request accepted", {
      component: "auth",
      event: "password_reset_request_accepted",
    });
    res.status(202).json(acceptedResponse);
  });
}

export function createPasswordResetConfirmHandler(
  dependencies: PasswordResetConfirmHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const request = passwordResetConfirmSchema.parse(req.body);
    let confirmed: boolean;

    try {
      confirmed = await dependencies.confirmReset(request);
    } catch (error) {
      dependencies.logger.error(
        "Password reset confirmation failed",
        { component: "auth", event: "password_reset_confirmation_failed" },
        error,
      );
      throw new HttpError(
        500,
        apiErrorCodes.internal,
        "Internal server error",
      );
    }

    if (!confirmed) {
      dependencies.logger.warn("Password reset token rejected", {
        component: "auth",
        event: "password_reset_token_rejected",
      });
      throw new HttpError(
        400,
        apiErrorCodes.invalidResetToken,
        "Password reset token is invalid or expired",
      );
    }

    dependencies.logger.info("Password reset confirmed", {
      component: "auth",
      event: "password_reset_confirmed",
    });
    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    res.status(204).end();
  });
}

export function registerPasswordResetRoutes(
  app: Express,
  options: RegisterPasswordResetRoutesOptions,
): void {
  const delivery = options.delivery ?? unavailablePasswordResetDelivery;
  app.post(
    PASSWORD_RESET_REQUEST_PATH,
    createPasswordResetRequestHandler({
      logger: options.logger,
      requestReset: (request) =>
        requestPasswordReset(options.database, request, delivery),
    }),
  );
  app.post(
    PASSWORD_RESET_CONFIRM_PATH,
    createPasswordResetConfirmHandler({
      confirmReset: (request) =>
        confirmPasswordReset(options.database, request),
      logger: options.logger,
    }),
  );
}
