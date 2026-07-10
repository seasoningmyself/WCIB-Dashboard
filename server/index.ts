import { createApp } from "./app.js";
import { loadConfig } from "./config/environment.js";
import {
  checkDatabaseConnection,
  createDatabasePool,
  formatDatabaseConnectionError,
} from "./db/client.js";
import { StructuredLogger } from "./logging/logger.js";

const config = loadConfig();
const logger = new StructuredLogger();
const app = createApp({ logger });
const pool = createDatabasePool(config.databaseUrl);
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
