import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  formatInitialRosterSeedError,
  formatInitialRosterSeedResult,
  parseInitialRosterCredentials,
  seedInitialRoster,
} from "../server/auth/initial-roster.js";
import { readPostgresUrl } from "../server/config/postgres-url.js";
import { createDatabasePool } from "../server/db/client.js";
import * as databaseSchema from "../server/db/schema.js";

let pool: ReturnType<typeof createDatabasePool> | undefined;

try {
  const databaseUrl = readPostgresUrl(
    "DATABASE_URL",
    process.env.DATABASE_URL,
  );
  const credentials = parseInitialRosterCredentials(
    process.env.WCIB_SEED_ROSTER_JSON,
  );
  pool = createDatabasePool(databaseUrl);
  const database = drizzle(pool, { schema: databaseSchema });
  const result = await seedInitialRoster(database, credentials);
  console.log(`Initial roster seed complete: ${formatInitialRosterSeedResult(result)}`);
} catch (error) {
  console.error(formatInitialRosterSeedError(error));
  process.exitCode = 1;
} finally {
  await pool?.end();
}
