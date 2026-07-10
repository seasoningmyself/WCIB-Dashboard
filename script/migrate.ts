import "dotenv/config";
import { applyMigrations, formatMigrationError } from "../server/db/migrate.js";
import { readMigrationDatabaseUrl } from "../server/db/migration-config.js";

try {
  const databaseUrl = readMigrationDatabaseUrl();
  await applyMigrations(databaseUrl);
  console.log("Database migrations applied successfully");
} catch (error) {
  console.error(formatMigrationError(error));
  process.exitCode = 1;
}
