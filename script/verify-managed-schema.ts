import "dotenv/config";
import { readMigrationDatabaseUrl } from "../server/db/migration-config.js";
import {
  formatManagedSchemaVerificationError,
  verifyManagedSchema,
} from "../server/db/managed-schema-verification.js";

try {
  const result = await verifyManagedSchema(readMigrationDatabaseUrl());
  console.log(
    `Managed schema verified: PostgreSQL ${result.serverVersion}, ${result.migrationCount} migrations, ${result.tableCount} tables, ${result.totalRows} rows`,
  );
  console.log(
    `Catalog: ${result.catalog.foreignKeys} foreign keys, ${result.catalog.checks} checks, ${result.catalog.triggers} triggers, ${result.catalog.functions} functions, ${result.catalog.indexes} indexes`,
  );
  console.log(`Schema fingerprint: ${result.fingerprint}`);
  console.log(`Verification time: ${result.checkedAt}`);
} catch (error) {
  console.error(formatManagedSchemaVerificationError(error));
  process.exitCode = 1;
}
