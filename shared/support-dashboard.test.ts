import assert from "node:assert/strict";
import { test } from "node:test";
import { operationalSupportDashboardSchema } from "./support-dashboard.js";

const NOW = "2026-07-22T18:00:00.000Z";
const FINGERPRINT = "a".repeat(64);

test("support dashboard contract is bounded and excludes diagnostic detail", () => {
  const dashboard = {
    administrators: [
      {
        displayName: "Sophia",
        email: "sophia@example.test",
        lastLoginAt: NOW,
        mfaEnrolled: true,
      },
    ],
    backup: {
      ageSeconds: 3_600,
      checkedAt: NOW,
      configured: true,
      freshnessThresholdHours: 30,
      latestRecoveryPointAt: NOW,
      pointInTimeRecoveryEnabled: true,
      provider: "digitalocean",
      status: "fresh",
    },
    environment: "production",
    health: { checkedAt: NOW, responseTimeMs: 0, status: "ok" },
    integrity: { checkedAt: NOW, status: "ok", warnings: [] },
    loginSecurity: {
      accountFailureBucketCount: 2,
      activeAccountThrottleCount: 1,
      activeIpThrottleCount: 0,
      checkedAt: NOW,
      ipFailureBucketCount: 1,
      lastFailureAt: NOW,
      maxAccountFailureCount: 5,
      maxIpFailureCount: 2,
      patterns: [
        {
          count: 1,
          kind: "account_repeated_failures",
          lastObservedAt: NOW,
          severity: "warning",
        },
      ],
      windowHours: 24,
    },
    migration: {
      checkedAt: NOW,
      countMatches: true,
      fingerprintMatches: true,
      localExpectedCount: 55,
      localFingerprint: FINGERPRINT,
      managedExpectedCount: 55,
      managedFingerprint: FINGERPRINT,
      status: "in_sync",
    },
    observedAt: NOW,
    readiness: {
      checkedAt: NOW,
      databaseReachable: true,
      responseTimeMs: 4,
      status: "ready",
    },
    release: {
      deployedAt: NOW,
      sha: "b".repeat(40),
      status: "available",
    },
    sentry: {
      configured: true,
      issues: [
        {
          eventCount: 3,
          firstSeen: NOW,
          lastSeen: NOW,
          level: "error",
          permalink: "https://wcib.sentry.io/issues/123/",
          project: "wcib",
          shortId: "WCIB-1",
          status: "unresolved",
          title: "Request failed",
        },
      ],
      lastSyncAt: NOW,
      status: "available",
    },
    uptime: {
      checkedAt: NOW,
      checkCount: 100,
      configured: true,
      failedCheckCount: 1,
      incidentCount: 1,
      lastIncidentAt: NOW,
      percentage: 99,
      source: "sentry",
      status: "available",
      windowDays: 30,
    },
  };

  assert.deepEqual(operationalSupportDashboardSchema.parse(dashboard), dashboard);
  assert.equal(
    operationalSupportDashboardSchema.safeParse({
      ...dashboard,
      rawAuditRows: [],
    }).success,
    false,
  );
  assert.equal(
    operationalSupportDashboardSchema.safeParse({
      ...dashboard,
      sentry: {
        ...dashboard.sentry,
        issues: [{ ...dashboard.sentry.issues[0], stackTrace: "secret" }],
      },
    }).success,
    false,
  );
});
