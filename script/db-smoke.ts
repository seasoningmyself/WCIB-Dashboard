import { loadConfig } from "../server/config/environment.js";
import {
  checkDatabaseConnection,
  createDatabasePool,
  formatDatabaseConnectionError,
} from "../server/db/client.js";

let pool: ReturnType<typeof createDatabasePool> | undefined;

try {
  const config = loadConfig();
  pool = createDatabasePool(config.databaseUrl);
  await checkDatabaseConnection(pool);
  console.log("Database connection successful");
} catch (error) {
  console.error(formatDatabaseConnectionError(error));
  process.exitCode = 1;
} finally {
  await pool?.end();
}
