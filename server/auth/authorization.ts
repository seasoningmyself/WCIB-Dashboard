import type { Request, RequestHandler, Response } from "express";
import {
  isAccessCapability,
  isStaffRole,
} from "../../shared/access.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import { loadAccessPrincipal } from "./access-repository.js";
import {
  evaluateAccess,
  type AccessPrincipal,
  type AccessRequirement,
} from "./access.js";
import {
  resolveAuthenticatedSession,
  type SessionUserLookup,
} from "./sessions.js";
import { findUserById, type AuthDatabase } from "./users.js";
import { loadMfaAccessState, type MfaAccessState } from "./mfa-state.js";
import { validateRecoveryGrant } from "./mfa-recovery.js";
import type { MfaAuthenticationState } from "../../shared/mfa-scaffold.js";
import { asyncRoute, HttpError } from "../http/errors.js";
import type { AppLogger } from "../logging/logger.js";
import { safeRouteLabel } from "../logging/request.js";

export const AUTHENTICATED_ACCESS = "authenticated" as const;

export type RouteAccessRequirement =
  | typeof AUTHENTICATED_ACCESS
  | AccessRequirement;

export interface AuthorizedRequestContext {
  authentication?: {
    recoveryGrantId?: string;
    state: MfaAuthenticationState;
  };
  principal: AccessPrincipal;
}

export interface AuthorizationDependencies {
  findUser: SessionUserLookup;
  loadPrincipal(userId: string): Promise<AccessPrincipal | null>;
  loadMfaState?(
    userId: string,
    options: { isAdmin: boolean },
  ): Promise<MfaAccessState>;
  logger: AppLogger;
  validateRecoveryGrant?(
    userId: string,
    grantId: string | undefined,
    sessionId: string,
  ): Promise<boolean>;
}

const authorizationGuardMarker = Symbol("wcib.authorizationGuard");

export type AuthorizationGuard = RequestHandler & {
  readonly [authorizationGuardMarker]: true;
};

export interface AuthorizationGuards {
  require(
    requirement?: RouteAccessRequirement,
    options?: AuthorizationGuardOptions,
  ): AuthorizationGuard;
}

export interface AuthorizationGuardOptions {
  allowMfaChallenge?: boolean;
  allowMfaEnrollment?: boolean;
  allowMfaRecovery?: boolean;
  allowPasswordChangeRequired?: boolean;
}

export class MissingAuthorizationContextError extends Error {
  constructor() {
    super("Authorization context is unavailable");
    this.name = "MissingAuthorizationContextError";
  }
}

const authorizationContextKey = Symbol("wcib.authorizationContext");

export function createAuthorizationGuards(
  dependencies: AuthorizationDependencies,
): AuthorizationGuards {
  return {
    require(requirement, options) {
      return createAuthorizationGuard(requirement, dependencies, options);
    },
  };
}

export function createDatabaseAuthorizationGuards(
  database: AuthDatabase,
  logger: AppLogger,
  options: { adminMfaEnforcementEnabled?: boolean } = {},
): AuthorizationGuards {
  return createAuthorizationGuards({
    findUser: (userId) => findUserById(database, userId),
    loadPrincipal: (userId) => loadAccessPrincipal(database, userId),
    loadMfaState: (userId, stateOptions) =>
      loadMfaAccessState(database, userId, {
        adminEnforcementEnabled:
          options.adminMfaEnforcementEnabled === true,
        isAdmin: stateOptions.isAdmin,
      }),
    logger,
    validateRecoveryGrant: (userId, grantId, sessionId) =>
      validateRecoveryGrant(database, userId, grantId, sessionId),
  });
}

export function getAuthorizedRequestContext(
  res: Response,
): AuthorizedRequestContext {
  const context = (res.locals as Record<PropertyKey, unknown>)[
    authorizationContextKey
  ];
  if (context === undefined) {
    throw new MissingAuthorizationContextError();
  }
  return context as AuthorizedRequestContext;
}

export function isAuthorizationGuard(value: unknown): value is AuthorizationGuard {
  return (
    typeof value === "function" &&
    (value as Partial<AuthorizationGuard>)[authorizationGuardMarker] === true
  );
}

function createAuthorizationGuard(
  requirement: RouteAccessRequirement | undefined,
  dependencies: AuthorizationDependencies,
  options: AuthorizationGuardOptions = {},
): AuthorizationGuard {
  const guard = asyncRoute(async (req, res, next) => {
    const session = await resolveAuthenticatedSession(
      req,
      res,
      dependencies.findUser,
      dependencies.logger,
    );
    if (!session.authenticated) {
      logDenial(dependencies.logger, req, "unauthenticated");
      next(
        new HttpError(
          401,
          apiErrorCodes.unauthorized,
          "Authentication required",
        ),
      );
      return;
    }

    if (
      session.user.passwordChangeRequiredAt !== null &&
      options.allowPasswordChangeRequired !== true
    ) {
      logDenial(
        dependencies.logger,
        req,
        "password_change_required",
        session.user.id,
      );
      next(
        new HttpError(
          403,
          apiErrorCodes.passwordChangeRequired,
          "Password change required",
        ),
      );
      return;
    }

    const principal = await dependencies.loadPrincipal(session.user.id);
    if (
      principal === null ||
      !principal.userActive ||
      principal.userId !== session.user.id
    ) {
      logDenial(
        dependencies.logger,
        req,
        "principal_unavailable",
        session.user.id,
      );
      next(new HttpError(403, apiErrorCodes.forbidden, "Forbidden"));
      return;
    }

    if (
      session.authenticationState === "mfa_challenge" &&
      options.allowMfaChallenge !== true
    ) {
      denyForMfa(
        dependencies.logger,
        req,
        next,
        apiErrorCodes.mfaChallengeRequired,
        "MFA challenge required",
        principal.userId,
      );
      return;
    }
    if (
      session.authenticationState === "mfa_enrollment" &&
      options.allowMfaEnrollment !== true
    ) {
      denyForMfa(
        dependencies.logger,
        req,
        next,
        apiErrorCodes.mfaEnrollmentRequired,
        "MFA enrollment must be completed",
        principal.userId,
      );
      return;
    }
    if (session.authenticationState === "mfa_recovery") {
      const validRecoveryGrant =
        dependencies.validateRecoveryGrant === undefined
          ? false
          : await dependencies.validateRecoveryGrant(
              principal.userId,
              session.recoveryGrantId,
              req.sessionID,
            );
      if (!validRecoveryGrant || options.allowMfaRecovery !== true) {
        denyForMfa(
          dependencies.logger,
          req,
          next,
          apiErrorCodes.mfaRecoveryRequired,
          "MFA recovery enrollment required",
          principal.userId,
        );
        return;
      }
    }

    const mfaState =
      dependencies.loadMfaState === undefined
        ? {
            activeMethodCount: 0,
            enrolled: false,
            enrollmentIncomplete: false,
            enforcementEnabled: false,
            policyRequired: false,
            recoveryCodesAcknowledged: false,
            requiresMfaLogin: false,
          }
        : await dependencies.loadMfaState(principal.userId, {
            isAdmin: principal.capabilities.includes("admin"),
          });
    if (
      session.authenticationState === "authenticated" &&
      !mfaState.enrolled &&
      (mfaState.policyRequired || mfaState.enrollmentIncomplete) &&
      options.allowMfaEnrollment !== true
    ) {
      denyForMfa(
        dependencies.logger,
        req,
        next,
        apiErrorCodes.mfaEnrollmentRequired,
        "MFA enrollment required",
        principal.userId,
      );
      return;
    }

    const decision =
      requirement === AUTHENTICATED_ACCESS
        ? { allowed: true as const }
        : evaluateAccess(principal, normalizeRequirement(requirement));
    if (!decision.allowed) {
      logDenial(
        dependencies.logger,
        req,
        decision.reason,
        principal.userId,
      );
      next(new HttpError(403, apiErrorCodes.forbidden, "Forbidden"));
      return;
    }

    setAuthorizedRequestContext(res, principal, {
      recoveryGrantId: session.recoveryGrantId,
      state: session.authenticationState,
    });
    next();
  });

  Object.defineProperty(guard, authorizationGuardMarker, { value: true });
  return guard as AuthorizationGuard;
}

function normalizeRequirement(
  requirement: RouteAccessRequirement | undefined,
): AccessRequirement {
  if (requirement === null || typeof requirement !== "object") {
    return {};
  }

  const staffRoles = Array.isArray(requirement.staffRoles)
    ? requirement.staffRoles.filter(isStaffRole)
    : [];
  const capabilities = Array.isArray(requirement.capabilities)
    ? requirement.capabilities.filter(isAccessCapability)
    : [];
  return { capabilities, staffRoles };
}

function setAuthorizedRequestContext(
  res: Response,
  principal: AccessPrincipal,
  authentication: NonNullable<AuthorizedRequestContext["authentication"]>,
): void {
  const trustedPrincipal = Object.freeze({
    ...principal,
    capabilities: Object.freeze([...principal.capabilities]),
  });
  (res.locals as Record<PropertyKey, unknown>)[authorizationContextKey] =
    Object.freeze({
      authentication: Object.freeze({ ...authentication }),
      principal: trustedPrincipal,
    });
}

function denyForMfa(
  logger: AppLogger,
  req: Request,
  next: Parameters<RequestHandler>[2],
  code:
    | typeof apiErrorCodes.mfaChallengeRequired
    | typeof apiErrorCodes.mfaEnrollmentRequired
    | typeof apiErrorCodes.mfaRecoveryRequired,
  message: string,
  userId: string,
): void {
  logDenial(logger, req, code, userId);
  next(new HttpError(403, code, message));
}

function logDenial(
  logger: AppLogger,
  req: Request,
  reason: string,
  userId?: string,
): void {
  logger.warn("Authorization denied", {
    component: "auth",
    event: "authorization_denied",
    method: req.method,
    reason,
    route: safeRouteLabel(req),
    ...(userId === undefined ? {} : { userId }),
  });
}
