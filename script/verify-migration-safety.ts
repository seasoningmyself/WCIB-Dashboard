import "dotenv/config";
import { readMigrationDatabaseUrl } from "../server/db/migration-config.js";
import {
  formatMigrationSafetyError,
  verifyMigrationSafety,
} from "../server/db/migration-safety.js";

try {
  const result = await verifyMigrationSafety(readMigrationDatabaseUrl());
  console.log(
    `Verified ${result.migrationCount} migrations through forward, rollback, and reapply`,
  );
  console.log(
    `Verified atomic failure rollback for ${result.failureInjectionTags.join(", ")}`,
  );
  for (const phase of result.phases) {
    console.log(
      `migration_phase=${phase.name} status=${phase.status} duration_ms=${phase.durationMs}`,
    );
  }
  console.log(`Final schema fingerprint: ${result.finalFingerprint}`);
} catch (error) {
  console.error(formatMigrationSafetyError(error));
  process.exitCode = 1;
}
