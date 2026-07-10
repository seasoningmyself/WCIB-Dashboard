import express, { type Express, type RequestHandler } from "express";
import {
  createErrorHandler,
  notFoundHandler,
  type UnexpectedErrorLogger,
} from "./http/errors.js";
import {
  registerHealthRoutes,
  type ReadinessCheck,
} from "./http/health.js";
import type { AppLogger } from "./logging/logger.js";
import { createRequestLoggingMiddleware } from "./logging/request.js";
import {
  auditRouteAccessDeclarations,
  createRouteRegistrar,
  type RouteRegistrar,
} from "./http/routes.js";

export interface CreateAppOptions {
  logger?: AppLogger;
  logUnexpectedError?: UnexpectedErrorLogger;
  readinessCheck?: ReadinessCheck;
  registerRoutes?: (routes: RouteRegistrar) => void;
  sessionMiddleware?: RequestHandler;
  trustProxy?: boolean;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const routes = createRouteRegistrar(app);

  app.disable("x-powered-by");
  if (options.trustProxy === true) {
    app.set("trust proxy", 1);
  }
  if (options.logger !== undefined) {
    app.use(createRequestLoggingMiddleware(options.logger));
  }
  registerHealthRoutes(routes, { readinessCheck: options.readinessCheck });
  if (options.sessionMiddleware !== undefined) {
    app.use(options.sessionMiddleware);
  }
  app.use(express.json());

  routes.get(
    "/api",
    {
      public: true,
      reason: "Service identity is intentionally available before login",
    },
    (_req, res) => {
      res.json({ name: "WCIB Dashboard API", status: "ok" });
    },
  );

  options.registerRoutes?.(routes);
  auditRouteAccessDeclarations(app);
  app.use(notFoundHandler);
  const logUnexpectedError =
    options.logUnexpectedError ??
    (options.logger === undefined
      ? undefined
      : (event: Parameters<UnexpectedErrorLogger>[0], error: unknown) => {
          options.logger?.error("Unhandled request error", { ...event }, error);
        });
  app.use(createErrorHandler(logUnexpectedError));

  return app;
}
