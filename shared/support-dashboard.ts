import { z } from "zod";
import {
  KPI_PERIOD_MONTHS,
  kpiActualPeriodSchema,
} from "./kpi-actuals.js";

const timestampSchema = z.string().datetime({ offset: true });
const nullableTimestampSchema = timestampSchema.nullable();
const durationSchema = z.number().int().min(0).max(60_000);
const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/);
const countSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const moneySchema = z.string().regex(/^(?:0|[1-9][0-9]{0,14})\.[0-9]{2}$/);
const rateSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]?|100)\.[0-9]{2}$/)
  .refine((value) => Number(value) <= 100);

export const supportDashboardQuerySchema = z
  .object({
    period: kpiActualPeriodSchema.optional(),
    year: z.coerce.number().int().min(2000).max(9999).optional(),
  })
  .strict();

export const SUPPORT_AUDIT_CATEGORIES = [
  "authentication",
  "mfa",
  "access_control",
  "system_maintenance",
  "business_workflow",
  "financial_workflow",
] as const;

export const supportAuditCategorySchema = z.enum(SUPPORT_AUDIT_CATEGORIES);

const supportAuditCategoryActivitySchema = z
  .object({
    count: countSchema,
    lastOccurredAt: nullableTimestampSchema,
    type: supportAuditCategorySchema,
  })
  .strict();

export const supportAuditActivitySchema = z
  .object({
    categories: z
      .array(supportAuditCategoryActivitySchema)
      .length(SUPPORT_AUDIT_CATEGORIES.length),
    latestEventAt: nullableTimestampSchema,
    totalEventCount: countSchema,
    windowEnd: timestampSchema,
    windowStart: timestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.categories.some(
        ({ type }, index) => type !== SUPPORT_AUDIT_CATEGORIES[index],
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Support audit categories must use the fixed order",
        path: ["categories"],
      });
    }
  });

const supportCompanyTotalsSchema = z
  .object({
    agencyRevenue: moneySchema,
    existingPolicyCount: countSchema,
    newPolicyCount: countSchema,
    newRevenue: moneySchema,
    policyCount: countSchema,
    retentionRate: rateSchema.nullable(),
    wonBackCount: countSchema,
    wonBackRevenue: moneySchema,
  })
  .strict();

const supportCompanyTargetsSchema = z
  .object({
    newPolicyCount: countSchema.nullable(),
    newRevenue: moneySchema.nullable(),
    retentionRate: rateSchema.nullable(),
  })
  .strict();

const supportCompanyMonthlySchema = z
  .object({
    agencyRevenue: moneySchema,
    month: z.number().int().min(1).max(12),
    newPolicyCount: countSchema,
    policyCount: countSchema,
  })
  .strict();

export const supportCompanyNumbersSchema = z
  .object({
    asOf: nullableTimestampSchema,
    empty: z.boolean(),
    monthly: z.array(supportCompanyMonthlySchema).max(12),
    period: kpiActualPeriodSchema,
    source: z.literal("closed_pay_sheets"),
    targets: supportCompanyTargetsSchema,
    totals: supportCompanyTotalsSchema,
    year: z.number().int().min(2000).max(9999),
  })
  .strict()
  .superRefine((value, context) => {
    const expectedMonths = KPI_PERIOD_MONTHS[value.period];
    if (
      value.monthly.length !== expectedMonths.length ||
      value.monthly.some(({ month }, index) => month !== expectedMonths[index])
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Support company months must match the selected period",
        path: ["monthly"],
      });
    }
  });

export const supportReleaseSchema = z
  .object({
    deployedAt: nullableTimestampSchema,
    sha: z.string().regex(/^[0-9a-f]{40,64}$/).nullable(),
    status: z.enum(["available", "unavailable"]),
  })
  .strict();

export const supportHealthSchema = z
  .object({
    checkedAt: timestampSchema,
    responseTimeMs: durationSchema,
    status: z.literal("ok"),
  })
  .strict();

export const supportReadinessSchema = z
  .object({
    checkedAt: timestampSchema,
    databaseReachable: z.boolean(),
    responseTimeMs: durationSchema,
    status: z.enum(["ready", "unavailable"]),
  })
  .strict();

export const supportMigrationParitySchema = z
  .object({
    checkedAt: timestampSchema,
    countMatches: z.boolean(),
    fingerprintMatches: z.boolean(),
    localExpectedCount: z.number().int().positive(),
    localFingerprint: fingerprintSchema,
    managedExpectedCount: z.number().int().positive().nullable(),
    managedFingerprint: fingerprintSchema.nullable(),
    status: z.enum(["in_sync", "mismatch", "unavailable"]),
  })
  .strict();

export const supportBackupSchema = z
  .object({
    ageSeconds: z.number().int().nonnegative().nullable(),
    checkedAt: timestampSchema,
    configured: z.boolean(),
    freshnessThresholdHours: z.number().int().positive().max(168),
    latestRecoveryPointAt: nullableTimestampSchema,
    pointInTimeRecoveryEnabled: z.boolean().nullable(),
    provider: z.literal("digitalocean"),
    status: z.enum(["fresh", "stale", "unavailable", "error"]),
  })
  .strict();

export const supportIntegrityWarningSchema = z
  .object({
    affectedCount: z.number().int().positive(),
    code: z.string().regex(/^[a-z][a-z0-9_]{1,79}$/),
    detectedAt: timestampSchema,
    severity: z.enum(["warning", "critical"]),
    title: z.string().trim().min(1).max(160),
  })
  .strict();

export const supportIntegritySchema = z
  .object({
    checkedAt: timestampSchema,
    status: z.enum(["ok", "warning", "unavailable"]),
    warnings: z.array(supportIntegrityWarningSchema).max(20),
  })
  .strict();

export const supportLoginSecurityPatternSchema = z
  .object({
    count: z.number().int().positive(),
    kind: z.enum([
      "account_repeated_failures",
      "ip_repeated_failures",
      "active_cooldowns",
    ]),
    lastObservedAt: timestampSchema,
    severity: z.enum(["notice", "warning"]),
  })
  .strict();

export const supportLoginSecuritySchema = z
  .object({
    accountFailureBucketCount: z.number().int().nonnegative(),
    activeAccountThrottleCount: z.number().int().nonnegative(),
    activeIpThrottleCount: z.number().int().nonnegative(),
    checkedAt: timestampSchema,
    ipFailureBucketCount: z.number().int().nonnegative(),
    lastFailureAt: nullableTimestampSchema,
    maxAccountFailureCount: z.number().int().nonnegative(),
    maxIpFailureCount: z.number().int().nonnegative(),
    patterns: z.array(supportLoginSecurityPatternSchema).max(3),
    windowHours: z.literal(24),
  })
  .strict();

export const supportSentryIssueSchema = z
  .object({
    eventCount: z.number().int().nonnegative(),
    firstSeen: timestampSchema,
    lastSeen: timestampSchema,
    level: z.string().trim().min(1).max(20),
    permalink: z.string().url().max(500),
    project: z.string().trim().min(1).max(100),
    shortId: z.string().trim().min(1).max(50),
    status: z.string().trim().min(1).max(30),
    title: z.string().trim().min(1).max(160),
  })
  .strict();

export const supportSentrySchema = z
  .object({
    configured: z.boolean(),
    issues: z.array(supportSentryIssueSchema).max(10),
    lastSyncAt: nullableTimestampSchema,
    status: z.enum(["available", "unavailable", "error"]),
  })
  .strict();

export const supportUptimeSchema = z
  .object({
    checkedAt: timestampSchema,
    checkCount: z.number().int().nonnegative(),
    configured: z.boolean(),
    failedCheckCount: z.number().int().nonnegative(),
    incidentCount: z.number().int().nonnegative(),
    lastIncidentAt: nullableTimestampSchema,
    percentage: z.number().min(0).max(100).nullable(),
    source: z.literal("sentry"),
    status: z.enum(["available", "unavailable", "error"]),
    windowDays: z.literal(30),
  })
  .strict();

export const supportAdministratorRecoverySchema = z
  .object({
    displayName: z.string().trim().min(1).max(200),
    email: z.string().email().max(320),
    lastLoginAt: nullableTimestampSchema,
    mfaEnrolled: z.boolean(),
  })
  .strict();

export const operationalSupportDashboardSchema = z
  .object({
    administrators: z.array(supportAdministratorRecoverySchema).max(100),
    auditActivity: supportAuditActivitySchema,
    backup: supportBackupSchema,
    companyNumbers: supportCompanyNumbersSchema,
    environment: z.enum(["development", "test", "production"]),
    health: supportHealthSchema,
    integrity: supportIntegritySchema,
    loginSecurity: supportLoginSecuritySchema,
    migration: supportMigrationParitySchema,
    observedAt: timestampSchema,
    readiness: supportReadinessSchema,
    release: supportReleaseSchema,
    sentry: supportSentrySchema,
    uptime: supportUptimeSchema,
  })
  .strict();

export type OperationalSupportDashboard = z.output<
  typeof operationalSupportDashboardSchema
>;
export type SupportAuditActivity = z.output<typeof supportAuditActivitySchema>;
export type SupportBackup = z.output<typeof supportBackupSchema>;
export type SupportCompanyNumbers = z.output<typeof supportCompanyNumbersSchema>;
export type SupportDashboardQuery = z.output<typeof supportDashboardQuerySchema>;
export type SupportSentry = z.output<typeof supportSentrySchema>;
export type SupportUptime = z.output<typeof supportUptimeSchema>;
export type SupportAuditCategory = (typeof SUPPORT_AUDIT_CATEGORIES)[number];
