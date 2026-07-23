import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CurrentUser } from "../../../shared/current-user.js";
import type { OperationalSupportDashboard } from "../../../shared/support-dashboard.js";
import { ApiClientProvider } from "../api/context.js";
import { createSessionBoundary } from "../auth/session-boundary.js";
import type { SupportApi } from "./api.js";
import { SupportDashboardView } from "./SupportDashboard.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const timestamp = "2026-07-22T12:00:00.000Z";

test("support dashboard renders operational and aggregate-only fields", () => {
  const markup = renderToStaticMarkup(
    <ApiClientProvider
      boundary={createSessionBoundary(() => {})}
      client={{ async request() { return Response.json({}); } }}
    >
      <SupportDashboardView
        api={stubApi}
        dashboard={dashboardFixture()}
        onApplyYear={() => {}}
        onPeriod={() => {}}
        onRefresh={() => {}}
        onYearDraft={() => {}}
        period="full"
        user={supportUser}
        year={2026}
        yearDraft="2026"
      />
    </ApiClientProvider>,
  );

  for (const expected of [
    "Release and availability",
    "KPI calculation health",
    "Records processed",
    "Reconciliation variance",
    "Monthly KPI calculation diagnostics",
    "Migration parity",
    "Backup freshness",
    "Data integrity",
    "Login security",
    "Administrators",
    "Sophia",
    "Audit activity",
    "Recent Sentry issues",
    "Reset another user&#x27;s MFA",
    "Loading office locations",
  ]) {
    assert.match(markup, new RegExp(expected));
  }
  assert.match(markup, /without exposing revenue, targets, pay-sheet records, policies, or people/);
  assert.doesNotMatch(markup, /\$|agency revenue|new revenue|revenue target|Manage Staff|Start Fresh|commission rate|producer payout|policy number/i);
});

const supportUser: CurrentUser = {
  allowedNavigation: ["support", "settings"],
  capabilities: ["support_engineer"],
  displayName: "Ennis",
  email: "support@example.test",
  id: USER_ID,
  passwordChangeRequired: false,
  role: null,
};

const stubApi: SupportApi = {
  async listAccounts() { return []; },
  async loadDashboard() { return dashboardFixture(); },
  async resetMfa() {},
};

function dashboardFixture(): OperationalSupportDashboard {
  return {
    administrators: [
      {
        displayName: "Sophia",
        email: "sophia@example.test",
        lastLoginAt: timestamp,
        mfaEnrolled: true,
      },
      {
        displayName: "Earl",
        email: "earl@example.test",
        lastLoginAt: null,
        mfaEnrolled: false,
      },
    ],
    auditActivity: {
      categories: [
        { count: 4, lastOccurredAt: timestamp, type: "authentication" },
        { count: 2, lastOccurredAt: timestamp, type: "mfa" },
        { count: 1, lastOccurredAt: timestamp, type: "access_control" },
        { count: 0, lastOccurredAt: null, type: "system_maintenance" },
        { count: 3, lastOccurredAt: timestamp, type: "business_workflow" },
        { count: 2, lastOccurredAt: timestamp, type: "financial_workflow" },
      ],
      latestEventAt: timestamp,
      totalEventCount: 12,
      windowEnd: timestamp,
      windowStart: "2026-07-21T12:00:00.000Z",
    },
    backup: {
      ageSeconds: 900,
      checkedAt: timestamp,
      configured: true,
      freshnessThresholdHours: 24,
      latestRecoveryPointAt: timestamp,
      pointInTimeRecoveryEnabled: true,
      provider: "digitalocean",
      status: "fresh",
    },
    kpiCalculation: {
      firstAnomalyMonth: null,
      lastSuccessfulCalculationAt: timestamp,
      missingOrIncompletePeriods: [],
      monthly: Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        newPolicyCount: index === 0 ? 2 : 0,
        policyCount: index === 0 ? 5 : 0,
        reportingStatus: "complete" as const,
      })),
      period: "full",
      reconciliationVariance: "none",
      recordsProcessed: 5,
      source: "closed_pay_sheets",
      status: "healthy",
      totals: {
        newPolicyCount: 2,
        policyCount: 5,
        retentionRate: "60.00",
        wonBackCount: 1,
      },
      year: 2026,
    },
    environment: "test",
    health: { checkedAt: timestamp, responseTimeMs: 0, status: "ok" },
    integrity: { checkedAt: timestamp, status: "ok", warnings: [] },
    loginSecurity: {
      accountFailureBucketCount: 2,
      activeAccountThrottleCount: 0,
      activeIpThrottleCount: 0,
      checkedAt: timestamp,
      ipFailureBucketCount: 1,
      lastFailureAt: timestamp,
      maxAccountFailureCount: 2,
      maxIpFailureCount: 3,
      patterns: [],
      windowHours: 24,
    },
    migration: {
      checkedAt: timestamp,
      countMatches: true,
      fingerprintMatches: true,
      localExpectedCount: 55,
      localFingerprint: "a".repeat(64),
      managedExpectedCount: 55,
      managedFingerprint: "a".repeat(64),
      status: "in_sync",
    },
    observedAt: timestamp,
    readiness: {
      checkedAt: timestamp,
      databaseReachable: true,
      responseTimeMs: 3,
      status: "ready",
    },
    release: {
      deployedAt: timestamp,
      sha: "b".repeat(40),
      status: "available",
    },
    sentry: {
      configured: true,
      issues: [{
        eventCount: 2,
        firstSeen: timestamp,
        lastSeen: timestamp,
        level: "error",
        permalink: "https://sentry.example.test/issues/1",
        project: "wcib",
        shortId: "WCIB-1",
        status: "unresolved",
        title: "Example application failure",
      }],
      lastSyncAt: timestamp,
      status: "available",
    },
    uptime: {
      checkedAt: timestamp,
      checkCount: 100,
      configured: true,
      failedCheckCount: 1,
      incidentCount: 1,
      lastIncidentAt: timestamp,
      percentage: 99.9,
      source: "sentry",
      status: "available",
      windowDays: 30,
    },
  };
}
