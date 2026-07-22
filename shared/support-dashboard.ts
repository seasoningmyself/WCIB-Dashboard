import { z } from "zod";

const timestampSchema = z.string().datetime({ offset: true });
const nullableTimestampSchema = timestampSchema.nullable();
const durationSchema = z.number().int().min(0).max(60_000);
const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/);

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
    backup: supportBackupSchema,
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
export type SupportBackup = z.output<typeof supportBackupSchema>;
export type SupportSentry = z.output<typeof supportSentrySchema>;
export type SupportUptime = z.output<typeof supportUptimeSchema>;
