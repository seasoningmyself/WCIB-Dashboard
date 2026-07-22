import assert from "node:assert/strict";
import { test } from "node:test";
import {
  operationalSupportDashboardSchema,
  SUPPORT_AUDIT_CATEGORIES,
  supportDashboardQuerySchema,
} from "./support-dashboard.js";

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
    auditActivity: {
      categories: SUPPORT_AUDIT_CATEGORIES.map((type, index) => ({
        count: index,
        lastOccurredAt: index === 0 ? null : NOW,
        type,
      })),
      latestEventAt: NOW,
      totalEventCount: 15,
      windowEnd: NOW,
      windowStart: "2026-07-21T18:00:00.000Z",
    },
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
    companyNumbers: {
      asOf: NOW,
      empty: false,
      monthly: [1, 2, 3].map((month) => ({
        agencyRevenue: "100.00",
        month,
        newPolicyCount: 1,
        policyCount: 2,
      })),
      period: "Q1",
      source: "closed_pay_sheets",
      targets: {
        newPolicyCount: 10,
        newRevenue: "1000.00",
        retentionRate: "80.00",
      },
      totals: {
        agencyRevenue: "300.00",
        existingPolicyCount: 3,
        newPolicyCount: 3,
        newRevenue: "150.00",
        policyCount: 6,
        retentionRate: "50.00",
        wonBackCount: 1,
        wonBackRevenue: "50.00",
      },
      year: 2026,
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
  assert.deepEqual(supportDashboardQuerySchema.parse({}), {});
  assert.deepEqual(
    supportDashboardQuerySchema.parse({ period: "Q3", year: "2026" }),
    { period: "Q3", year: 2026 },
  );
  assert.equal(
    supportDashboardQuerySchema.safeParse({ scopeType: "producer" }).success,
    false,
  );
});
