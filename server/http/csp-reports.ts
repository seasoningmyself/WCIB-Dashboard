import express, { type RequestHandler } from "express";
import { z } from "zod";
import { CSP_REPORT_PATH } from "../../shared/security-policy.js";
import type { AppLogger } from "../logging/logger.js";
import { asyncRoute } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

const MAX_REPORTS_PER_REQUEST = 20;
const MAX_LOG_VALUE_LENGTH = 500;

const legacyReportSchema = z
  .object({
    "blocked-uri": z.unknown().optional(),
    "column-number": z.unknown().optional(),
    "document-uri": z.unknown().optional(),
    "effective-directive": z.unknown().optional(),
    "line-number": z.unknown().optional(),
    "source-file": z.unknown().optional(),
    "status-code": z.unknown().optional(),
    "violated-directive": z.unknown().optional(),
  })
  .passthrough();

const reportingApiReportSchema = z
  .object({
    body: z.unknown().optional(),
    type: z.unknown().optional(),
    url: z.unknown().optional(),
  })
  .passthrough();

interface CspLogFields {
  blockedSource?: string;
  columnNumber?: number;
  documentPath?: string;
  effectiveDirective?: string;
  lineNumber?: number;
  sourcePath?: string;
  statusCode?: number;
}

export function cspReportBodyParser(): RequestHandler {
  return express.json({
    limit: "64kb",
    type: ["application/csp-report", "application/reports+json"],
  });
}

export function createCspReportHandler(logger?: AppLogger): RequestHandler {
  return asyncRoute(async (req, res) => {
    for (const report of normalizeReports(req.body).slice(
      0,
      MAX_REPORTS_PER_REQUEST,
    )) {
      logger?.warn("CSP report-only violation observed", {
        component: "security",
        event: "csp_report_only_violation",
        ...report,
      });
    }
    res.status(204).end();
  });
}

export function registerCspReportRoute(
  routes: RouteRegistrar,
  logger?: AppLogger,
): void {
  routes.post(
    CSP_REPORT_PATH,
    {
      public: true,
      reason: "Browsers need anonymous access to report CSP violations",
    },
    cspReportBodyParser(),
    createCspReportHandler(logger),
  );
}

function normalizeReports(body: unknown): CspLogFields[] {
  if (Array.isArray(body)) {
    return body.flatMap((candidate) => {
      const parsed = reportingApiReportSchema.safeParse(candidate);
      if (!parsed.success || parsed.data.type !== "csp-violation") {
        return [];
      }
      return normalizeReportBody(parsed.data.body, parsed.data.url);
    });
  }
  if (body !== null && typeof body === "object" && "csp-report" in body) {
    return normalizeLegacyReport(
      (body as { "csp-report"?: unknown })["csp-report"],
    );
  }
  return normalizeReportBody(body);
}

function normalizeReportBody(body: unknown, reportUrl?: unknown): CspLogFields[] {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return [];
  }
  const candidate = body as Record<string, unknown>;
  return [compactFields({
    blockedSource: safeSource(candidate.blockedURL ?? candidate.blockedUri),
    columnNumber: safeInteger(candidate.columnNumber),
    documentPath: safeUrl(candidate.documentURL ?? reportUrl),
    effectiveDirective: safeText(
      candidate.effectiveDirective ?? candidate.violatedDirective,
    ),
    lineNumber: safeInteger(candidate.lineNumber),
    sourcePath: safeUrl(candidate.sourceFile),
    statusCode: safeInteger(candidate.statusCode),
  })];
}

function normalizeLegacyReport(body: unknown): CspLogFields[] {
  const parsed = legacyReportSchema.safeParse(body);
  if (!parsed.success) {
    return [];
  }
  const report = parsed.data;
  return [compactFields({
    blockedSource: safeSource(report["blocked-uri"]),
    columnNumber: safeInteger(report["column-number"]),
    documentPath: safeUrl(report["document-uri"]),
    effectiveDirective: safeText(
      report["effective-directive"] ?? report["violated-directive"],
    ),
    lineNumber: safeInteger(report["line-number"]),
    sourcePath: safeUrl(report["source-file"]),
    statusCode: safeInteger(report["status-code"]),
  })];
}

function compactFields(fields: CspLogFields): CspLogFields {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as CspLogFields;
}

function safeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

function safeSource(value: unknown): string | undefined {
  if (value === "inline" || value === "eval") {
    return value;
  }
  return safeUrl(value);
}

function safeText(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  return value.slice(0, MAX_LOG_VALUE_LENGTH);
}

function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  try {
    const url = new URL(value, "http://csp-report.invalid");
    const prefix = url.origin === "http://csp-report.invalid" ? "" : url.origin;
    return `${prefix}${url.pathname}`.slice(0, MAX_LOG_VALUE_LENGTH);
  } catch {
    return safeText(value);
  }
}
