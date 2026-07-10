import type { Request, RequestHandler } from "express";
import type { AppLogger } from "./logger.js";

export interface RequestLoggingOptions {
  now?: () => number;
}

export function safeRouteLabel(req: Request): string {
  const routePath = (req.route as { path?: unknown } | undefined)?.path;
  return typeof routePath === "string"
    ? `${req.baseUrl}${routePath}`
    : "unmatched";
}

export function createRequestLoggingMiddleware(
  logger: AppLogger,
  options: RequestLoggingOptions = {},
): RequestHandler {
  const now = options.now ?? Date.now;

  return (req, res, next) => {
    const startedAt = now();

    res.once("finish", () => {
      if (res.statusCode >= 500) {
        return;
      }

      const context = {
        durationMs: Math.max(0, now() - startedAt),
        event: "http_request_completed",
        method: req.method,
        route: safeRouteLabel(req),
        statusCode: res.statusCode,
      };

      if (res.statusCode >= 400) {
        logger.warn("HTTP request completed", context);
        return;
      }
      logger.info("HTTP request completed", context);
    });

    next();
  };
}
