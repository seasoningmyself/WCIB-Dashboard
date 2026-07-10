import connectPgSimple from "connect-pg-simple";
import type { Request, RequestHandler, Response } from "express";
import session from "express-session";
import type { CookieOptions } from "express-session";
import type pg from "pg";
import { z } from "zod";
import type { NodeEnvironment } from "../config/environment.js";
import type { AppLogger } from "../logging/logger.js";
import type { UserAccount } from "./users.js";
import "./session-data.js";

export const SESSION_COOKIE_NAME = "wcib.sid";
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

const sessionUserIdSchema = z.string().uuid();

export const sessionRejectionReasons = {
  invalidIdentity: "invalid_identity",
  missingIdentity: "missing_identity",
  userDisabled: "user_disabled",
  userNotFound: "user_not_found",
  versionMismatch: "version_mismatch",
} as const;

export type SessionRejectionReason =
  (typeof sessionRejectionReasons)[keyof typeof sessionRejectionReasons];

export type AuthenticatedSessionResult =
  | { authenticated: true; user: UserAccount }
  | { authenticated: false; reason: SessionRejectionReason };

export type SessionUserLookup = (
  userId: string,
) => Promise<UserAccount | null>;

export interface SessionMiddlewareOptions {
  logger?: AppLogger;
  nodeEnv: NodeEnvironment;
  secret: string;
}

export function getSessionCookieOptions(
  nodeEnv: NodeEnvironment,
): CookieOptions {
  return {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_MS,
    sameSite: "lax",
    secure: nodeEnv === "production",
  };
}

export function createSessionMiddleware(
  pool: pg.Pool,
  options: SessionMiddlewareOptions,
): RequestHandler {
  const PostgresSessionStore = connectPgSimple(session);
  const store = new PostgresSessionStore({
    createTableIfMissing: false,
    errorLog: (...args: unknown[]) => {
      const error = args.find((value) => value instanceof Error);
      options.logger?.error(
        "Session store error",
        { component: "auth", event: "session_store_error" },
        error,
      );
    },
    pool,
    tableName: "sessions",
  });

  return session({
    cookie: getSessionCookieOptions(options.nodeEnv),
    name: SESSION_COOKIE_NAME,
    resave: false,
    saveUninitialized: false,
    secret: options.secret,
    store,
  });
}

export async function establishAuthenticatedSession(
  req: Request,
  user: Pick<UserAccount, "id" | "isActive" | "sessionVersion">,
): Promise<void> {
  if (!user.isActive) {
    throw new Error("Cannot establish a session for an inactive user");
  }

  await regenerateSession(req);
  req.session.userId = user.id;
  req.session.sessionVersion = user.sessionVersion;
  await saveSession(req);
}

export async function resolveAuthenticatedSession(
  req: Request,
  res: Response,
  findUser: SessionUserLookup,
  logger?: AppLogger,
): Promise<AuthenticatedSessionResult> {
  const userId = req.session.userId;
  const sessionVersion = req.session.sessionVersion;

  if (userId === undefined && sessionVersion === undefined) {
    return rejectSession(
      req,
      res,
      sessionRejectionReasons.missingIdentity,
      logger,
    );
  }

  if (
    !sessionUserIdSchema.safeParse(userId).success ||
    !Number.isInteger(sessionVersion) ||
    (sessionVersion ?? -1) < 0
  ) {
    return rejectSession(
      req,
      res,
      sessionRejectionReasons.invalidIdentity,
      logger,
    );
  }

  const user = await findUser(userId as string);
  if (user === null) {
    return rejectSession(
      req,
      res,
      sessionRejectionReasons.userNotFound,
      logger,
    );
  }
  if (!user.isActive) {
    return rejectSession(
      req,
      res,
      sessionRejectionReasons.userDisabled,
      logger,
    );
  }
  if (user.sessionVersion !== sessionVersion) {
    return rejectSession(
      req,
      res,
      sessionRejectionReasons.versionMismatch,
      logger,
    );
  }

  return { authenticated: true, user };
}

export async function destroyAuthenticatedSession(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      req.session.destroy((error) => {
        if (error === null || error === undefined) {
          resolve();
          return;
        }
        reject(error);
      });
    });
  } finally {
    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
  }
}

async function rejectSession(
  req: Request,
  res: Response,
  reason: SessionRejectionReason,
  logger?: AppLogger,
): Promise<AuthenticatedSessionResult> {
  await destroyAuthenticatedSession(req, res);
  logger?.warn("Session rejected", {
    component: "auth",
    event: "session_rejected",
    reason,
  });
  return { authenticated: false, reason };
}

async function regenerateSession(req: Request): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error === null || error === undefined) {
        resolve();
        return;
      }
      reject(error);
    });
  });
}

async function saveSession(req: Request): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    req.session.save((error) => {
      if (error === null || error === undefined) {
        resolve();
        return;
      }
      reject(error);
    });
  });
}
