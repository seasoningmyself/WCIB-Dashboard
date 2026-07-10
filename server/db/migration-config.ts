import { readPostgresUrl } from "../config/postgres-url.js";

export function readMigrationDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return readPostgresUrl(
    "DATABASE_MIGRATE_URL or DATABASE_URL",
    env.DATABASE_MIGRATE_URL ?? env.DATABASE_URL,
  );
}
