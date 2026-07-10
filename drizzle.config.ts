import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { readMigrationDatabaseUrl } from "./server/db/migration-config.js";

export default defineConfig({
  dbCredentials: {
    url: readMigrationDatabaseUrl(),
  },
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./server/db/schema.ts",
  strict: true,
  verbose: true,
});
