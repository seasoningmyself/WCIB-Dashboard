import express, { type Express } from "express";
import {
  createErrorHandler,
  notFoundHandler,
  type UnexpectedErrorLogger,
} from "./http/errors.js";
import type { AppLogger } from "./logging/logger.js";
import { createRequestLoggingMiddleware } from "./logging/request.js";

export interface CreateAppOptions {
  logger?: AppLogger;
  logUnexpectedError?: UnexpectedErrorLogger;
  registerRoutes?: (app: Express) => void;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  app.disable("x-powered-by");
  if (options.logger !== undefined) {
    app.use(createRequestLoggingMiddleware(options.logger));
  }
  app.use(express.json());

  app.get("/api", (_req, res) => {
    res.json({ name: "WCIB Dashboard API", status: "ok" });
  });

  options.registerRoutes?.(app);
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
