import express, { type Express, type RequestHandler } from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
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
  clientAssetsDirectory?: string;
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
  if (options.clientAssetsDirectory !== undefined) {
    registerClientAssets(app, routes, options.clientAssetsDirectory);
  }
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

function registerClientAssets(
  app: Express,
  routes: RouteRegistrar,
  assetsDirectory: string,
): void {
  const directory = resolve(assetsDirectory);
  const indexPath = resolve(directory, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error("Production client index is missing");
  }

  app.use(
    express.static(directory, {
      immutable: true,
      index: false,
      maxAge: "1y",
    }),
  );
  routes.get(
    "/",
    {
      public: true,
      reason: "Users need the public application shell before login",
    },
    (_req, res) => {
      res.set("Cache-Control", "no-store").sendFile(indexPath);
    },
  );
}
