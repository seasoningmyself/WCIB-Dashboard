import type { Request, RequestHandler, Response } from "express";
import {
  loginRequestSchema,
  type LoginRequest,
  type LoginResponse,
} from "../../shared/login.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import { loadAccessPrincipal } from "../auth/access-repository.js";
import type { AccessPrincipal } from "../auth/access.js";
import { authenticateLoginCredentials } from "../auth/login.js";
import type { AuthenticatedLogin } from "../auth/login.js";
import {
  createDatabaseLoginThrottle,
  type LoginThrottle,
  type LoginThrottleDecision,
} from "../auth/login-throttle.js";
import { verifyPassword } from "../auth/password.js";
import {
  destroyAuthenticatedSession,
  establishAuthenticatedSession,
  establishMfaSession,
} from "../auth/sessions.js";
import { loadMfaAccessState, type MfaAccessState } from "../auth/mfa-state.js";
import {
  findUserCredentialsByEmail,
  opportunisticallyUpgradePasswordHash,
  type AuthDatabase,
  type UserAccount,
} from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { PasswordResetDelivery } from "../auth/password-reset-delivery.js";
import { registerPasswordResetRoutes } from "./password-reset.js";
import type { RouteRegistrar } from "./routes.js";

export const LOGIN_PATH = "/api/auth/login";
export const LOGOUT_PATH = "/api/auth/logout";

export interface LoginHandlerDependencies {
  authenticate(request: LoginRequest): Promise<AuthenticatedLogin | null>;
  establishSession(req: Request, user: UserAccount): Promise<void>;
  establishMfaSession?(
    req: Request,
    user: UserAccount,
    state: "mfa_challenge" | "mfa_enrollment",
  ): Promise<void>;
  loadMfaState?(
    userId: string,
    isAdmin: boolean,
    isSupportEngineer: boolean,
  ): Promise<MfaAccessState>;
  loadPrincipal(userId: string): Promise<AccessPrincipal | null>;
  logger: AppLogger;
  throttle?: LoginThrottle;
  upgradePasswordHash?(
    userId: string,
    password: string,
    currentPasswordHash: string,
  ): Promise<boolean>;
}

export interface RegisterAuthRoutesOptions {
  adminMfaEnforcementEnabled?: boolean;
  allUsersMfaEnforcementEnabled?: boolean;
  database: AuthDatabase;
  logger: AppLogger;
  loginThrottleSecret?: string;
  loginMiddleware?: readonly RequestHandler[];
  passwordResetDelivery?: PasswordResetDelivery;
}

export interface LogoutHandlerDependencies {
  destroySession(req: Request, res: Response): Promise<void>;
  logger: AppLogger;
}

export function createLoginHandler(
  dependencies: LoginHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const request = loginRequestSchema.parse(req.body);
    const throttle = dependencies.throttle ?? noOpLoginThrottle;
    const throttleKeys = {
      account: request.email,
      ip: req.ip || req.socket.remoteAddress || "unknown",
    };
    const activeCooldown = await throttle.check(throttleKeys);
    if (activeCooldown !== null) {
      throwTooManyAttempts(res, activeCooldown);
    }

    const authenticated = await dependencies.authenticate(request);

    if (authenticated === null) {
      dependencies.logger.warn("Login failed", {
        component: "auth",
        event: "login_failed",
        reason: "invalid_credentials",
      });
      const cooldown = await throttle.recordFailure(throttleKeys);
      if (cooldown !== null) {
        throwTooManyAttempts(res, cooldown);
      }
      throw invalidCredentialsError();
    }

    const user = authenticated.account;

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
      const cooldown = await throttle.recordFailure(throttleKeys);
      if (cooldown !== null) {
        throwTooManyAttempts(res, cooldown);
      }
      throw invalidCredentialsError();
    }

    if (dependencies.upgradePasswordHash !== undefined) {
      try {
        await dependencies.upgradePasswordHash(
          user.id,
          request.password,
          authenticated.verifiedPasswordHash,
        );
      } catch (error) {
        dependencies.logger.warn("Password hash upgrade deferred", {
          component: "auth",
          event: "password_hash_upgrade_deferred",
          userId: user.id,
        });
      }
    }

    const mfaState =
      dependencies.loadMfaState === undefined
        ? null
        : await dependencies.loadMfaState(
            user.id,
            principal.capabilities.includes("admin"),
            principal.capabilities.includes("support_engineer"),
          );
    const mfaSessionState = user.passwordChangeRequiredAt !== null
      ? null
      : mfaState?.requiresMfaLogin === true
        ? "mfa_challenge"
        : mfaState?.policyRequired === true ||
            mfaState?.enrollmentIncomplete === true
          ? "mfa_enrollment"
          : null;
    if (mfaSessionState !== null) {
      if (dependencies.establishMfaSession === undefined) {
        throw new Error("MFA session establishment is unavailable");
      }
      await dependencies.establishMfaSession(req, user, mfaSessionState);
    } else {
      await throttle.clearAccount(throttleKeys.account);
      await dependencies.establishSession(req, user);
    }
    const response: LoginResponse = {
      authenticationState:
        mfaSessionState === null ? "authenticated" : "mfa_required",
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

export function createLogoutHandler(
  dependencies: LogoutHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    try {
      await dependencies.destroySession(req, res);
    } catch (error) {
      dependencies.logger.error(
        "Logout failed",
        { component: "auth", event: "logout_failed" },
        error,
      );
      throw new HttpError(
        500,
        apiErrorCodes.internal,
        "Internal server error",
      );
    }

    dependencies.logger.info("Logout succeeded", {
      component: "auth",
      event: "logout_succeeded",
    });
    res.status(204).end();
  });
}

export function registerAuthRoutes(
  routes: RouteRegistrar,
  options: RegisterAuthRoutesOptions,
): void {
  const throttle =
    options.loginThrottleSecret === undefined
      ? undefined
      : createDatabaseLoginThrottle(
          options.database,
          options.loginThrottleSecret,
          options.logger,
        );
  const handler = createLoginHandler({
    authenticate: (request) =>
      authenticateLoginCredentials(request, {
        findCredentialsByEmail: (email) =>
          findUserCredentialsByEmail(options.database, email),
        verifyPassword,
      }),
    establishSession: establishAuthenticatedSession,
    establishMfaSession,
    loadMfaState: (userId, isAdmin, isSupportEngineer) =>
      loadMfaAccessState(options.database, userId, {
        adminEnforcementEnabled:
          options.adminMfaEnforcementEnabled === true,
        allUsersEnforcementEnabled:
          options.allUsersMfaEnforcementEnabled === true,
        isAdmin,
        isSupportEngineer,
      }),
    loadPrincipal: (userId) => loadAccessPrincipal(options.database, userId),
    logger: options.logger,
    throttle,
    upgradePasswordHash: (userId, password, currentPasswordHash) =>
      opportunisticallyUpgradePasswordHash(
        options.database,
        userId,
        password,
        currentPasswordHash,
      ),
  });
  const logoutHandler = createLogoutHandler({
    destroySession: destroyAuthenticatedSession,
    logger: options.logger,
  });

  routes.post(
    LOGIN_PATH,
    {
      public: true,
      reason: "Users need anonymous access to establish a session",
    },
    ...(options.loginMiddleware ?? []),
    handler,
  );
  routes.post(
    LOGOUT_PATH,
    {
      public: true,
      reason: "Logout is idempotent for expired or anonymous sessions",
    },
    logoutHandler,
  );
  registerPasswordResetRoutes(routes, {
    database: options.database,
    delivery: options.passwordResetDelivery,
    logger: options.logger,
  });
}

function invalidCredentialsError(): HttpError {
  return new HttpError(
    401,
    apiErrorCodes.invalidCredentials,
    "Invalid email or password",
  );
}

const noOpLoginThrottle: LoginThrottle = {
  async check() {
    return null;
  },
  async clearAccount() {},
  async recordFailure() {
    return null;
  },
};

function throwTooManyAttempts(
  res: Response,
  decision: LoginThrottleDecision,
): never {
  res.set("Retry-After", String(decision.retryAfterSeconds));
  const minutes = Math.max(1, Math.ceil(decision.retryAfterSeconds / 60));
  throw new HttpError(
    429,
    apiErrorCodes.tooManyAttempts,
    `Too many attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
  );
}
