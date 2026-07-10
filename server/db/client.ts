import pg from "pg";
import { readDatabaseErrorCode } from "./error-code.js";

export interface DatabaseQueryable {
  query<Row extends pg.QueryResultRow>(queryText: string): Promise<{ rows: Row[] }>;
}

export function createDatabasePool(databaseUrl: string): pg.Pool {
  return new pg.Pool({
    application_name: "wcib-dashboard",
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: 10,
  });
}

export async function checkDatabaseConnection(
  database: DatabaseQueryable,
): Promise<void> {
  const result = await database.query<{ connected: number }>(
    "select 1 as connected",
  );

  if (result.rows[0]?.connected !== 1) {
    throw new Error("Database connection check returned an unexpected result");
  }
}

export function formatDatabaseConnectionError(error: unknown): string {
  const code = readDatabaseErrorCode(error);
  return code === undefined
    ? "Database connection failed"
    : `Database connection failed (${code})`;
}
