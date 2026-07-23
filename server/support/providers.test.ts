import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  DigitalOceanBackupConfig,
  SentrySupportConfig,
} from "../config/support.js";
import { createDigitalOceanBackupProvider } from "./digitalocean-backups.js";
import { createSentrySupportProvider } from "./sentry.js";

const NOW = new Date("2026-07-22T18:00:00.000Z");

test("Sentry provider returns only scrubbed issue summaries and aggregate uptime", async () => {
  const requests: Array<{ authorization: string | null; url: URL }> = [];
  const config: SentrySupportConfig = {
    apiBaseUrl: "https://sentry.io/api/0",
    apiToken: "sentry-secret",
    environment: "production",
    organizationSlug: "wcib",
    projectSlug: "dashboard",
    uptimeMonitorId: "monitor_123",
  };
  const provider = createSentrySupportProvider(
    config,
    async (input, init) => {
      const url = new URL(String(input));
      requests.push({
        authorization: new Headers(init?.headers).get("authorization"),
        url,
      });
      if (url.pathname.endsWith("/events/")) {
        return jsonResponse({
          data: [
            {
              "count()": 100,
              "count_if(check_status,equal,success)": 99,
            },
          ],
        });
      }
      if (url.searchParams.get("query") === "issue.type:uptime_domain_failure") {
        return jsonResponse([sentryIssue("WCIB-UPTIME", "Service unavailable")]);
      }
      return jsonResponse([
        sentryIssue(
          "WCIB-1",
          "Request for person@example.com at 00000000-0000-4000-8000-000000000001 failed",
        ),
      ]);
    },
  );

  const snapshot = await provider.load(NOW);
  assert.equal(snapshot.sentry.status, "available");
  assert.equal(
    snapshot.sentry.issues[0]?.title,
    "Request for [email] at [id] failed",
  );
  assert.deepEqual(
    {
      checkCount: snapshot.uptime.checkCount,
      failedCheckCount: snapshot.uptime.failedCheckCount,
      incidentCount: snapshot.uptime.incidentCount,
      percentage: snapshot.uptime.percentage,
    },
    { checkCount: 100, failedCheckCount: 1, incidentCount: 1, percentage: 99 },
  );
  assert.equal(requests.length, 3);
  assert.equal(
    requests.every(({ authorization }) => authorization === "Bearer sentry-secret"),
    true,
  );
  assert.equal(JSON.stringify(snapshot).includes("sentry-secret"), false);
});

test("DigitalOcean provider reports bounded backup freshness without credentials", async () => {
  const config: DigitalOceanBackupConfig = {
    apiBaseUrl: "https://api.digitalocean.com/v2",
    apiToken: "digitalocean-secret",
    databaseClusterId: "00000000-0000-4000-8000-000000000001",
    pointInTimeRecoveryEnabled: true,
  };
  let authorization: string | null = null;
  const provider = createDigitalOceanBackupProvider(
    config,
    30,
    async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization");
      return jsonResponse({
        backups: [
          { created_at: "2026-07-21T12:00:00.000Z", size_gigabytes: 1.5 },
          { created_at: "2026-07-22T17:00:00.000Z", size_gigabytes: 1.6 },
        ],
      });
    },
  );
  const backup = await provider.load(NOW);
  assert.equal(authorization, "Bearer digitalocean-secret");
  assert.deepEqual(backup, {
    ageSeconds: 3_600,
    checkedAt: NOW.toISOString(),
    configured: true,
    freshnessThresholdHours: 30,
    latestRecoveryPointAt: "2026-07-22T17:00:00.000Z",
    pointInTimeRecoveryEnabled: true,
    provider: "digitalocean",
    status: "fresh",
  });
  assert.equal(JSON.stringify(backup).includes("digitalocean-secret"), false);
});

function sentryIssue(shortId: string, title: string) {
  return {
    count: "3",
    firstSeen: "2026-07-21T18:00:00.000Z",
    id: shortId,
    lastSeen: "2026-07-22T17:30:00.000Z",
    level: "error",
    permalink: `https://wcib.sentry.io/issues/${shortId}/`,
    project: { slug: "dashboard" },
    shortId,
    status: "unresolved",
    title,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
