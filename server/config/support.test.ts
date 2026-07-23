import assert from "node:assert/strict";
import { test } from "node:test";
import { readSupportConfig } from "./support.js";

test("support providers are disabled cleanly when no credentials are configured", () => {
  const config = readSupportConfig({});
  assert.equal(config.digitalOceanBackup, null);
  assert.equal(config.sentry, null);
  assert.deepEqual(config.release, { deployedAt: null, sha: null });
  assert.equal(config.backupFreshnessThresholdHours, 30);
});

test("support provider config validates complete server-only credentials", () => {
  const config = readSupportConfig(
    {
      DIGITALOCEAN_DATABASE_CLUSTER_ID:
        "00000000-0000-4000-8000-000000000001",
      DIGITALOCEAN_DATABASE_PITR_ENABLED: "true",
      DIGITALOCEAN_SUPPORT_API_TOKEN: "digitalocean-secret",
      SENTRY_API_TOKEN: "sentry-secret",
      SENTRY_ENVIRONMENT: "production",
      SENTRY_ORG_SLUG: "wcib",
      SENTRY_PROJECT_SLUG: "dashboard",
      SENTRY_UPTIME_MONITOR_ID: "monitor_123",
      WCIB_BACKUP_FRESHNESS_HOURS: "36",
      WCIB_DEPLOYED_AT: "2026-07-22T18:00:00.000Z",
      WCIB_RELEASE_SHA: "a".repeat(40),
    },
  );
  assert.equal(config.sentry?.organizationSlug, "wcib");
  assert.equal(config.sentry?.uptimeMonitorId, "monitor_123");
  assert.equal(config.digitalOceanBackup?.pointInTimeRecoveryEnabled, true);
  assert.equal(config.backupFreshnessThresholdHours, 36);
  assert.deepEqual(config.release, {
    deployedAt: "2026-07-22T18:00:00.000Z",
    sha: "a".repeat(40),
  });
  const serialized = JSON.stringify({
    backupFreshnessThresholdHours: config.backupFreshnessThresholdHours,
    release: config.release,
  });
  assert.equal(serialized.includes("sentry-secret"), false);
  assert.equal(serialized.includes("digitalocean-secret"), false);
});

test("partial support provider configuration fails closed", () => {
  assert.throws(
    () => readSupportConfig({ SENTRY_API_TOKEN: "secret" }),
    /must be configured together/,
  );
  assert.throws(
    () =>
      readSupportConfig(
        {
          DIGITALOCEAN_DATABASE_CLUSTER_ID:
            "00000000-0000-4000-8000-000000000001",
        },
      ),
    /must be configured together/,
  );
});
