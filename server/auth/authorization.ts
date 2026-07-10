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
import { asyncRoute, HttpError } from "../http/errors.js";
import type { AppLogger } from "../logging/logger.js";
import { safeRouteLabel } from "../logging/request.js";

export const AUTHENTICATED_ACCESS = "authenticated" as const;

export type RouteAccessRequirement =
  | typeof AUTHENTICATED_ACCESS
  | AccessRequirement;

export interface AuthorizedRequestContext {
  principal: AccessPrincipal;
}

export interface AuthorizationDependencies {
  findUser: SessionUserLookup;
  loadPrincipal(userId: string): Promise<AccessPrincipal | null>;
  logger: AppLogger;
}

export interface AuthorizationGuards {
  require(requirement?: RouteAccessRequirement): RequestHandler;
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
    require(requirement) {
      return createAuthorizationGuard(requirement, dependencies);
    },
  };
}

export function createDatabaseAuthorizationGuards(
  database: AuthDatabase,
  logger: AppLogger,
): AuthorizationGuards {
  return createAuthorizationGuards({
    findUser: (userId) => findUserById(database, userId),
    loadPrincipal: (userId) => loadAccessPrincipal(database, userId),
    logger,
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

function createAuthorizationGuard(
  requirement: RouteAccessRequirement | undefined,
  dependencies: AuthorizationDependencies,
): RequestHandler {
  return asyncRoute(async (req, res, next) => {
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

    setAuthorizedRequestContext(res, principal);
    next();
  });
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
): void {
  const trustedPrincipal = Object.freeze({
    ...principal,
    capabilities: Object.freeze([...principal.capabilities]),
  });
  (res.locals as Record<PropertyKey, unknown>)[authorizationContextKey] =
    Object.freeze({ principal: trustedPrincipal });
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
