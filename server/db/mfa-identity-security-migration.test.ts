import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0053_mfa_identity_security.sql"),
  "utf8",
);
const backout = readFileSync(
  resolve(process.cwd(), "drizzle/backout/0053_mfa_identity_security.sql"),
  "utf8",
);

test("MFA migration installs normalized protected identity-security storage", () => {
  for (const table of [
    "mfa_challenges",
    "mfa_recovery_grants",
    "mfa_step_up_authorizations",
    "user_mfa_recovery_codes",
    "user_totp_credentials",
    "user_webauthn_credentials",
    "user_webauthn_credential_transports",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  }
  assert.match(migration, /RENAME TO "user_mfa_methods"/);
  assert.match(migration, /AES|wcibenc:v1|user_totp_credentials_envelope_check/);
  assert.match(migration, /user_mfa_recovery_codes_hash_check/);
  assert.match(migration, /mfa_challenges_hash_check/);
  assert.match(migration, /mfa_step_up_authorizations_hashes_check/);
  assert.doesNotMatch(migration, /"transports" text\[\]/);
  assert.match(migration, /"expected_migration_count" = 54/);
  assert.match(
    migration,
    /a8a02c5d60d29136b7a0a28202ae97e05dfdf423d3c8e40440d18e3c60617ebf/,
  );
});

test("MFA audit vocabulary is transactionally reversible and backout fails closed", () => {
  assert.ok(
    migration.indexOf('DROP FUNCTION "record_audit_event"') <
      migration.indexOf('ALTER TYPE "audit_action" RENAME'),
  );
  assert.ok(
    migration.indexOf('ALTER TABLE "audit_events"') <
      migration.indexOf('DROP TYPE "audit_action_before_mfa_security"'),
  );
  assert.match(backout, /mfa_identity_security_history_in_use/);
  assert.match(backout, /MFA identity-security history is in use; preserve it and forward-fix/);
  assert.match(backout, /"expected_migration_count" = 53/);
  assert.match(
    backout,
    /2e9f37930b5a85aa44f6a77184ba013eda6eb246133e5c02dc2a4d1a91d5fd2b/,
  );
  assert.ok(
    backout.indexOf('DROP TABLE "user_webauthn_credential_transports"') <
      backout.indexOf('DROP TABLE "user_webauthn_credentials"'),
  );
});
