import type { Express } from "express";

export type ReadinessCheck = () => Promise<void>;

export interface HealthRouteOptions {
  readinessCheck?: ReadinessCheck;
}

const disableCaching = { "Cache-Control": "no-store" };

export function registerHealthRoutes(
  app: Express,
  options: HealthRouteOptions = {},
): void {
  app.get("/health", (_req, res) => {
    res.set(disableCaching).json({ status: "ok" });
  });

  app.get("/ready", async (_req, res) => {
    if (options.readinessCheck === undefined) {
      res
        .set(disableCaching)
        .status(503)
        .json({ status: "unavailable" });
      return;
    }

    try {
      await options.readinessCheck();
      res.set(disableCaching).json({ status: "ready" });
    } catch {
      res
        .set(disableCaching)
        .status(503)
        .json({ status: "unavailable" });
    }
  });
}
