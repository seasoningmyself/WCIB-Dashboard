import { createApp } from "./app.js";
import { loadConfig } from "./config/environment.js";
import {
  checkDatabaseConnection,
  createDatabasePool,
  formatDatabaseConnectionError,
} from "./db/client.js";

const config = loadConfig();
const app = createApp();
const pool = createDatabasePool(config.databaseUrl);
let databaseConnected = false;

try {
  await checkDatabaseConnection(pool);
  databaseConnected = true;
  console.log("Database connection established");
} catch (error) {
  console.error(formatDatabaseConnectionError(error));
  process.exitCode = 1;
  await pool.end();
}

if (databaseConnected) {
  app.listen(config.port, () => {
    console.log(
      `WCIB Dashboard API listening on port ${config.port} (${config.nodeEnv})`,
    );
  });
}
