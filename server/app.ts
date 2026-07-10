import express, { type Express } from "express";
import {
  createErrorHandler,
  notFoundHandler,
  type UnexpectedErrorLogger,
} from "./http/errors.js";

export interface CreateAppOptions {
  logUnexpectedError?: UnexpectedErrorLogger;
  registerRoutes?: (app: Express) => void;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json());

  app.get("/api", (_req, res) => {
    res.json({ name: "WCIB Dashboard API", status: "ok" });
  });

  options.registerRoutes?.(app);
  app.use(notFoundHandler);
  app.use(createErrorHandler(options.logUnexpectedError));

  return app;
}
