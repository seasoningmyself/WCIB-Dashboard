import { drizzle } from "drizzle-orm/node-postgres";
import { createApp } from "./app.js";
import { createSessionMiddleware } from "./auth/sessions.js";
import { loadConfig } from "./config/environment.js";
import {
  checkDatabaseConnection,
  createDatabasePool,
  formatDatabaseConnectionError,
} from "./db/client.js";
import * as databaseSchema from "./db/schema.js";
import { registerAuthRoutes } from "./http/auth.js";
import { StructuredLogger } from "./logging/logger.js";

const config = loadConfig();
const logger = new StructuredLogger();
const pool = createDatabasePool(config.databaseUrl);
const database = drizzle(pool, { schema: databaseSchema });
const app = createApp({
  logger,
  readinessCheck: () => checkDatabaseConnection(pool),
  registerRoutes: (routes) => {
    registerAuthRoutes(routes, { database, logger });
  },
  sessionMiddleware: createSessionMiddleware(pool, {
    logger,
    nodeEnv: config.nodeEnv,
    secret: config.sessionSecret,
  }),
  trustProxy: config.nodeEnv === "production",
});
let databaseConnected = false;

try {
  await checkDatabaseConnection(pool);
  databaseConnected = true;
  logger.info("Database connection established", {
    component: "database",
    event: "database_connection_established",
  });
} catch (error) {
  logger.error(
    formatDatabaseConnectionError(error),
    { component: "database", event: "database_connection_failed" },
    error,
  );
  process.exitCode = 1;
  await pool.end();
}

if (databaseConnected) {
  app.listen(config.port, () => {
    logger.info("WCIB Dashboard API listening", {
      component: "http",
      environment: config.nodeEnv,
      event: "server_listening",
      port: config.port,
    });
  });
}
