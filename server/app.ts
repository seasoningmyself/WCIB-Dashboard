import express, { type Express } from "express";

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json());

  app.get("/api", (_req, res) => {
    res.json({ name: "WCIB Dashboard API", status: "ok" });
  });

  return app;
}
