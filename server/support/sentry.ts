import { z } from "zod";
import {
  supportSentrySchema,
  supportUptimeSchema,
  type SupportSentry,
  type SupportUptime,
} from "../../shared/support-dashboard.js";
import type { SentrySupportConfig } from "../config/support.js";

export interface SupportTelemetrySnapshot {
  sentry: SupportSentry;
  uptime: SupportUptime;
}

export interface SupportTelemetryProvider {
  load(now: Date): Promise<SupportTelemetrySnapshot>;
}

type Fetch = typeof fetch;

const issueSchema = z
  .object({
    count: z.string().regex(/^\d+$/),
    firstSeen: z.string().datetime({ offset: true }),
    id: z.string().min(1).max(100),
    lastSeen: z.string().datetime({ offset: true }),
    level: z.string().min(1).max(20),
    permalink: z.string().url().max(500),
    project: z.object({ slug: z.string().min(1).max(100) }).passthrough(),
    shortId: z.string().min(1).max(50),
    status: z.string().min(1).max(30),
    title: z.string().min(1).max(500),
  })
  .passthrough();

const issueListSchema = z.array(issueSchema).max(100);
const exploreResponseSchema = z
  .object({
    data: z.array(z.record(z.unknown())).max(10),
  })
  .passthrough();

const TOTAL_FIELD = "count()";
const SUCCESS_FIELD = "count_if(check_status,equal,success)";

export function createSentrySupportProvider(
  config: SentrySupportConfig | null,
  fetchImplementation: Fetch = fetch,
): SupportTelemetryProvider {
  if (config === null) return unavailableProvider;
  return {
    async load(now) {
      const [issues, uptime] = await Promise.all([
        loadIssues(config, fetchImplementation),
        loadUptime(config, fetchImplementation, now),
      ]);
      return {
        sentry: supportSentrySchema.parse({
          configured: true,
          issues,
          lastSyncAt: now.toISOString(),
          status: "available",
        }),
        uptime,
      };
    },
  };
}

export function unavailableSupportTelemetry(now: Date): SupportTelemetrySnapshot {
  return {
    sentry: supportSentrySchema.parse({
      configured: false,
      issues: [],
      lastSyncAt: null,
      status: "unavailable",
    }),
    uptime: supportUptimeSchema.parse({
      checkedAt: now.toISOString(),
      checkCount: 0,
      configured: false,
      failedCheckCount: 0,
      incidentCount: 0,
      lastIncidentAt: null,
      percentage: null,
      source: "sentry",
      status: "unavailable",
      windowDays: 30,
    }),
  };
}

const unavailableProvider: SupportTelemetryProvider = {
  async load(now) {
    return unavailableSupportTelemetry(now);
  },
};

async function loadIssues(
  config: SentrySupportConfig,
  fetchImplementation: Fetch,
) {
  const url = organizationUrl(config, "issues/");
  url.searchParams.set("project", config.projectSlug);
  if (config.environment !== null) {
    url.searchParams.set("environment", config.environment);
  }
  url.searchParams.set("statsPeriod", "14d");
  url.searchParams.set("query", "is:unresolved");
  url.searchParams.set("sort", "date");
  url.searchParams.set("limit", "10");
  url.searchParams.append("collapse", "stats");
  const payload = issueListSchema.parse(
    await fetchSentryJson(config, url, fetchImplementation),
  );
  return payload.map((issue) => ({
    eventCount: boundedInteger(issue.count),
    firstSeen: issue.firstSeen,
    lastSeen: issue.lastSeen,
    level: issue.level,
    permalink: requireSentryPermalink(issue.permalink),
    project: issue.project.slug,
    shortId: issue.shortId,
    status: issue.status,
    title: sanitizeIssueTitle(issue.title),
  }));
}

async function loadUptime(
  config: SentrySupportConfig,
  fetchImplementation: Fetch,
  now: Date,
): Promise<SupportUptime> {
  if (config.uptimeMonitorId === null) {
    return supportUptimeSchema.parse({
      checkedAt: now.toISOString(),
      checkCount: 0,
      configured: false,
      failedCheckCount: 0,
      incidentCount: 0,
      lastIncidentAt: null,
      percentage: null,
      source: "sentry",
      status: "unavailable",
      windowDays: 30,
    });
  }

  const statsUrl = organizationUrl(config, "events/");
  statsUrl.searchParams.set("dataset", "uptime_results");
  statsUrl.searchParams.append("field", TOTAL_FIELD);
  statsUrl.searchParams.append("field", SUCCESS_FIELD);
  statsUrl.searchParams.set("project", config.projectSlug);
  statsUrl.searchParams.set("statsPeriod", "30d");
  statsUrl.searchParams.set(
    "query",
    `uptime_subscription_id:${config.uptimeMonitorId}`,
  );
  if (config.environment !== null) {
    statsUrl.searchParams.set("environment", config.environment);
  }

  const incidentUrl = organizationUrl(config, "issues/");
  incidentUrl.searchParams.set("project", config.projectSlug);
  incidentUrl.searchParams.set("statsPeriod", "30d");
  incidentUrl.searchParams.set(
    "query",
    "issue.type:uptime_domain_failure",
  );
  incidentUrl.searchParams.set("limit", "100");

  const [statsPayload, incidentPayload] = await Promise.all([
    fetchSentryJson(config, statsUrl, fetchImplementation),
    fetchSentryJson(config, incidentUrl, fetchImplementation),
  ]);
  const row = exploreResponseSchema.parse(statsPayload).data[0] ?? {};
  const checkCount = numberField(row[TOTAL_FIELD]);
  const successfulChecks = Math.min(
    checkCount,
    numberField(row[SUCCESS_FIELD]),
  );
  const incidents = issueListSchema.parse(incidentPayload);
  const lastIncidentAt = incidents
    .map(({ lastSeen }) => lastSeen)
    .sort()
    .at(-1) ?? null;
  return supportUptimeSchema.parse({
    checkedAt: now.toISOString(),
    checkCount,
    configured: true,
    failedCheckCount: checkCount - successfulChecks,
    incidentCount: incidents.length,
    lastIncidentAt,
    percentage:
      checkCount === 0
        ? null
        : Math.round((successfulChecks / checkCount) * 100_000) / 1_000,
    source: "sentry",
    status: "available",
    windowDays: 30,
  });
}

async function fetchSentryJson(
  config: SentrySupportConfig,
  url: URL,
  fetchImplementation: Fetch,
): Promise<unknown> {
  const response = await fetchImplementation(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.apiToken}`,
    },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`Sentry support request failed with status ${response.status}`);
  }
  return response.json();
}

function organizationUrl(config: SentrySupportConfig, path: string): URL {
  return new URL(
    `${config.apiBaseUrl}/organizations/${encodeURIComponent(
      config.organizationSlug,
    )}/${path}`,
  );
}

function requireSentryPermalink(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !(url.hostname === "sentry.io" || url.hostname.endsWith(".sentry.io"))
  ) {
    throw new Error("Sentry returned an untrusted issue link");
  }
  url.username = "";
  url.password = "";
  return url.toString();
}

function sanitizeIssueTitle(value: string): string {
  const sanitized = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "[id]",
    )
    .replace(/\bhttps?:\/\/\S+/gi, "[url]")
    .replace(/\s+/g, " ")
    .trim();
  return (sanitized || "Application error").slice(0, 160);
}

function boundedInteger(value: string): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0
    ? Math.min(parsed, 2_147_483_647)
    : 0;
}

function numberField(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(Math.trunc(parsed), 2_147_483_647);
}
