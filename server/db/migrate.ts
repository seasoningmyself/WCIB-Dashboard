import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { readDatabaseErrorCode } from "./error-code.js";

export const migrationAdvisoryLockKey = 2_147_031_942;

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
  const client = new pg.Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
  });
  let lockAcquired = false;

  try {
    await client.connect();
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [migrationAdvisoryLockKey],
    );
    if (lock.rows[0]?.locked !== true) {
      throw new Error("Another migration process holds the database lock");
    }
    lockAcquired = true;
    await migrate(drizzle(client), {
      migrationsFolder: resolve(process.cwd(), "drizzle"),
    });
  } finally {
    if (lockAcquired) {
      await client
        .query("SELECT pg_advisory_unlock($1)", [migrationAdvisoryLockKey])
        .catch(() => undefined);
    }
    await client.end().catch(() => undefined);
  }
}
