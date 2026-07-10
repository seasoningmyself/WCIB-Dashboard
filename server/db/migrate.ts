import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { readDatabaseErrorCode } from "./error-code.js";

export function formatMigrationError(error: unknown): string {
  if (
    error instanceof Error &&
    error.message.startsWith("DATABASE_MIGRATE_URL or DATABASE_URL")
  ) {
    return error.message;
  }

  const code = readDatabaseErrorCode(error);
  return code === undefined
    ? "Database migration failed"
    : `Database migration failed (${code})`;
}

export async function applyMigrations(databaseUrl: string): Promise<void> {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    max: 1,
  });

  try {
    await migrate(drizzle(pool), {
      migrationsFolder: resolve(process.cwd(), "drizzle"),
    });
  } finally {
    await pool.end();
  }
}
