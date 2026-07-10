import type { RouteRegistrar } from "./routes.js";

export type ReadinessCheck = () => Promise<void>;

export interface HealthRouteOptions {
  readinessCheck?: ReadinessCheck;
}

const disableCaching = { "Cache-Control": "no-store" };

export function registerHealthRoutes(
  routes: RouteRegistrar,
  options: HealthRouteOptions = {},
): void {
  routes.get(
    "/health",
    {
      public: true,
      reason: "Infrastructure requires liveness before authentication",
    },
    (_req, res) => {
      res.set(disableCaching).json({ status: "ok" });
    },
  );

  routes.get(
    "/ready",
    {
      public: true,
      reason: "Infrastructure requires readiness before authentication",
    },
    async (_req, res) => {
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
    },
  );
}
