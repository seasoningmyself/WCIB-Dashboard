import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

interface ErrorDetails {
  cause?: unknown;
  code?: unknown;
  errors?: unknown;
}

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const details = error as ErrorDetails;

  if (typeof details.code === "string") {
    return details.code;
  }

  if (Array.isArray(details.errors)) {
    for (const nestedError of details.errors) {
      const nestedCode = readErrorCode(nestedError);

      if (nestedCode !== undefined) {
        return nestedCode;
      }
    }
  }

  const causeCode = readErrorCode(details.cause);

  if (causeCode !== undefined) {
    return causeCode;
  }

  return undefined;
}

export function formatMigrationError(error: unknown): string {
  if (
    error instanceof Error &&
    error.message.startsWith("DATABASE_MIGRATE_URL or DATABASE_URL")
  ) {
    return error.message;
  }

  const code = readErrorCode(error);
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
