import type { Express, Request, RequestHandler } from "express";
import {
  loginRequestSchema,
  type LoginRequest,
  type LoginResponse,
} from "../../shared/login.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import { loadAccessPrincipal } from "../auth/access-repository.js";
import type { AccessPrincipal } from "../auth/access.js";
import { authenticateLoginCredentials } from "../auth/login.js";
import { verifyPassword } from "../auth/password.js";
import { establishAuthenticatedSession } from "../auth/sessions.js";
import {
  findUserCredentialsByEmail,
  type AuthDatabase,
  type UserAccount,
} from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import { asyncRoute, HttpError } from "./errors.js";

export const LOGIN_PATH = "/api/auth/login";

export interface LoginHandlerDependencies {
  authenticate(request: LoginRequest): Promise<UserAccount | null>;
  establishSession(req: Request, user: UserAccount): Promise<void>;
  loadPrincipal(userId: string): Promise<AccessPrincipal | null>;
  logger: AppLogger;
}

export interface RegisterAuthRoutesOptions {
  database: AuthDatabase;
  logger: AppLogger;
  loginMiddleware?: readonly RequestHandler[];
}

export function createLoginHandler(
  dependencies: LoginHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const request = loginRequestSchema.parse(req.body);
    const user = await dependencies.authenticate(request);

    if (user === null) {
      dependencies.logger.warn("Login failed", {
        component: "auth",
        event: "login_failed",
        reason: "invalid_credentials",
      });
      throw invalidCredentialsError();
    }

    const principal = await dependencies.loadPrincipal(user.id);
    if (
      principal === null ||
      !principal.userActive ||
      principal.userId !== user.id
    ) {
      dependencies.logger.warn("Login failed", {
        component: "auth",
        event: "login_failed",
        reason: "identity_unavailable",
        userId: user.id,
      });
      throw invalidCredentialsError();
    }

    await dependencies.establishSession(req, user);
    const response: LoginResponse = {
      user: {
        capabilities: [...principal.capabilities].sort(),
        email: user.email,
        id: user.id,
        staffRole: principal.staffRole,
      },
    };

    dependencies.logger.info("Login succeeded", {
      component: "auth",
      event: "login_succeeded",
      userId: user.id,
    });
    res.json(response);
  });
}

export function registerAuthRoutes(
  app: Express,
  options: RegisterAuthRoutesOptions,
): void {
  const handler = createLoginHandler({
    authenticate: (request) =>
      authenticateLoginCredentials(request, {
        findCredentialsByEmail: (email) =>
          findUserCredentialsByEmail(options.database, email),
        verifyPassword,
      }),
    establishSession: establishAuthenticatedSession,
    loadPrincipal: (userId) => loadAccessPrincipal(options.database, userId),
    logger: options.logger,
  });

  app.post(LOGIN_PATH, ...(options.loginMiddleware ?? []), handler);
}

function invalidCredentialsError(): HttpError {
  return new HttpError(
    401,
    apiErrorCodes.invalidCredentials,
    "Invalid email or password",
  );
}
