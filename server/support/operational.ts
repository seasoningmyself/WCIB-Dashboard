import { and, asc, eq, gte, sql } from "drizzle-orm";
import type { AccessRequirement } from "../auth/access.js";
import { evaluateAccess } from "../auth/access.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { loadMfaAccessState } from "../auth/mfa-state.js";
import type { AuthDatabase } from "../auth/users.js";
import { writeAuditEventInDrizzleTransaction } from "../audit/event.js";
import type { NodeEnvironment } from "../config/environment.js";
import type { SupportConfig } from "../config/support.js";
import {
  approvedCoreMigrationCount,
  approvedCoreSchemaFingerprint,
} from "../db/core-schema-contract.js";
import {
  businessStateControl,
  loginThrottleBuckets,
  userCapabilities,
  users,
} from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import {
  operationalSupportDashboardSchema,
  supportBackupSchema,
  supportIntegritySchema,
  supportLoginSecuritySchema,
  supportMigrationParitySchema,
  supportReadinessSchema,
  supportSentrySchema,
  supportUptimeSchema,
  type OperationalSupportDashboard,
  type SupportBackup,
} from "../../shared/support-dashboard.js";
import type { SupportBackupProvider } from "./digitalocean-backups.js";
import type {
  SupportTelemetryProvider,
  SupportTelemetrySnapshot,
} from "./sentry.js";

export const SUPPORT_DASHBOARD_ACCESS = {
  capabilities: ["support_engineer"],
} as const satisfies AccessRequirement;

const LOGIN_SECURITY_WINDOW_MS = 24 * 60 * 60 * 1_000;
const MAX_THROTTLE_BUCKETS = 10_000;
const MAX_ADMINISTRATORS = 100;

export interface OperationalSupportOptions {
  backupProvider: SupportBackupProvider;
  config: SupportConfig;
  logger: AppLogger;
  nodeEnv: NodeEnvironment;
  now?: () => Date;
  readinessCheck?: () => Promise<void>;
  telemetryProvider: SupportTelemetryProvider;
  timer?: () => number;
}

export class SupportDashboardAccessDeniedError extends Error {
  constructor() {
    super("Support dashboard access denied");
    this.name = "SupportDashboardAccessDeniedError";
  }
}

export class SupportDashboardBoundsError extends Error {
  constructor() {
    super("Support dashboard result exceeds its supported bound");
    this.name = "SupportDashboardBoundsError";
  }
}

export async function loadOperationalSupportDashboard(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  options: OperationalSupportOptions,
): Promise<OperationalSupportDashboard> {
  requireSupportAccess(context);
  const now = options.now?.() ?? new Date();
  const timer = options.timer ?? (() => performance.now());
  const [readiness, migration, backup, integrity, loginSecurity, telemetry, administrators] =
    await Promise.all([
      loadReadiness(options.readinessCheck, now, timer),
      loadMigrationParity(database, now),
      loadBackup(options, now),
      loadIntegrity(database, now, options.logger),
      loadLoginSecurity(database, now),
      loadTelemetry(options, now),
      loadAdministratorRecovery(database),
    ]);

  const source = operationalSupportDashboardSchema.parse({
    administrators,
    backup,
    environment: options.nodeEnv,
    health: {
      checkedAt: now.toISOString(),
      responseTimeMs: 0,
      status: "ok",
    },
    integrity,
    loginSecurity,
    migration,
    observedAt: now.toISOString(),
    readiness,
    release: {
      deployedAt: options.config.release.deployedAt,
      sha: options.config.release.sha,
      status:
        options.config.release.deployedAt !== null &&
        options.config.release.sha !== null
          ? "available"
          : "unavailable",
    },
    sentry: telemetry.sentry,
    uptime: telemetry.uptime,
  });

  await database.transaction(async (transaction) => {
    await writeAuditEventInDrizzleTransaction(
      transaction,
      context,
      {
        action: "support_surface_viewed",
        after: {
          allowedFields: ["outcome"],
          source: { outcome: "success" },
        },
        entityId: context.principal.userId,
        entityType: "user",
      },
      options.logger,
    );
  });
  options.logger.info("Support dashboard loaded", {
    actorUserId: context.principal.userId,
    component: "support_dashboard",
    event: "support_dashboard_loaded",
  });
  return source;
}

export function projectOperationalSupportDashboard(
  source: Readonly<OperationalSupportDashboard>,
  context: AuthorizedRequestContext,
): OperationalSupportDashboard | null {
  if (!evaluateAccess(context.principal, SUPPORT_DASHBOARD_ACCESS).allowed) {
    return null;
  }
  return operationalSupportDashboardSchema.parse(source);
}

async function loadReadiness(
  check: (() => Promise<void>) | undefined,
  now: Date,
  timer: () => number,
) {
  const started = timer();
  if (check === undefined) {
    return supportReadinessSchema.parse({
      checkedAt: now.toISOString(),
      databaseReachable: false,
      responseTimeMs: elapsedMilliseconds(started, timer()),
      status: "unavailable",
    });
  }
  try {
    await check();
    return supportReadinessSchema.parse({
      checkedAt: now.toISOString(),
      databaseReachable: true,
      responseTimeMs: elapsedMilliseconds(started, timer()),
      status: "ready",
    });
  } catch {
    return supportReadinessSchema.parse({
      checkedAt: now.toISOString(),
      databaseReachable: false,
      responseTimeMs: elapsedMilliseconds(started, timer()),
      status: "unavailable",
    });
  }
}

async function loadMigrationParity(database: AuthDatabase, now: Date) {
  const [control] = await database
    .select({
      expectedMigrationCount: businessStateControl.expectedMigrationCount,
      expectedSchemaFingerprint:
        businessStateControl.expectedSchemaFingerprint,
    })
    .from(businessStateControl)
    .where(eq(businessStateControl.singletonId, 1))
    .limit(1);
  const countMatches =
    control?.expectedMigrationCount === approvedCoreMigrationCount;
  const fingerprintMatches =
    control?.expectedSchemaFingerprint === approvedCoreSchemaFingerprint;
  return supportMigrationParitySchema.parse({
    checkedAt: now.toISOString(),
    countMatches,
    fingerprintMatches,
    localExpectedCount: approvedCoreMigrationCount,
    localFingerprint: approvedCoreSchemaFingerprint,
    managedExpectedCount: control?.expectedMigrationCount ?? null,
    managedFingerprint: control?.expectedSchemaFingerprint ?? null,
    status:
      control === undefined
        ? "unavailable"
        : countMatches && fingerprintMatches
          ? "in_sync"
          : "mismatch",
  });
}

async function loadBackup(
  options: OperationalSupportOptions,
  now: Date,
): Promise<SupportBackup> {
  try {
    return await options.backupProvider.load(now);
  } catch (error) {
    options.logger.warn("Backup status provider unavailable", {
      component: "support_dashboard",
      event: "support_backup_provider_failed",
    });
    return supportBackupSchema.parse({
      ageSeconds: null,
      checkedAt: now.toISOString(),
      configured: options.config.digitalOceanBackup !== null,
      freshnessThresholdHours:
        options.config.backupFreshnessThresholdHours,
      latestRecoveryPointAt: null,
      pointInTimeRecoveryEnabled:
        options.config.digitalOceanBackup?.pointInTimeRecoveryEnabled ?? null,
      provider: "digitalocean",
      status: "error",
    });
  }
}

async function loadTelemetry(
  options: OperationalSupportOptions,
  now: Date,
): Promise<SupportTelemetrySnapshot> {
  try {
    return await options.telemetryProvider.load(now);
  } catch {
    options.logger.warn("Sentry support provider unavailable", {
      component: "support_dashboard",
      event: "support_sentry_provider_failed",
    });
    return {
      sentry: supportSentrySchema.parse({
        configured: options.config.sentry !== null,
        issues: [],
        lastSyncAt: null,
        status: "error",
      }),
      uptime: supportUptimeSchema.parse({
        checkedAt: now.toISOString(),
        checkCount: 0,
        configured:
          options.config.sentry !== null &&
          options.config.sentry.uptimeMonitorId !== null,
        failedCheckCount: 0,
        incidentCount: 0,
        lastIncidentAt: null,
        percentage: null,
        source: "sentry",
        status: "error",
        windowDays: 30,
      }),
    };
  }
}

async function loadAdministratorRecovery(database: AuthDatabase) {
  const rows = await database
    .select({
      displayName: users.displayName,
      email: users.email,
      lastLoginAt: users.lastLoginAt,
      userId: users.id,
    })
    .from(userCapabilities)
    .innerJoin(users, eq(users.id, userCapabilities.userId))
    .where(
      and(
        eq(userCapabilities.capability, "admin"),
        eq(userCapabilities.isActive, true),
        eq(users.isActive, true),
      ),
    )
    .orderBy(asc(sql`lower(${users.displayName})`), asc(users.id))
    .limit(MAX_ADMINISTRATORS + 1);
  if (rows.length > MAX_ADMINISTRATORS) {
    throw new SupportDashboardBoundsError();
  }
  return Promise.all(
    rows.map(async ({ userId, ...row }) => {
      const mfa = await loadMfaAccessState(database, userId, {
        adminEnforcementEnabled: false,
        allUsersEnforcementEnabled: false,
        isAdmin: true,
      });
      return {
        ...row,
        lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
        mfaEnrolled: mfa.enrolled,
      };
    }),
  );
}

async function loadLoginSecurity(database: AuthDatabase, now: Date) {
  const windowStart = new Date(now.getTime() - LOGIN_SECURITY_WINDOW_MS);
  const rows = await database
    .select({
      blockedUntil: loginThrottleBuckets.blockedUntil,
      failureCount: loginThrottleBuckets.failureCount,
      kind: loginThrottleBuckets.kind,
      lastFailedAt: loginThrottleBuckets.lastFailedAt,
    })
    .from(loginThrottleBuckets)
    .where(gte(loginThrottleBuckets.lastFailedAt, windowStart))
    .orderBy(asc(loginThrottleBuckets.lastFailedAt))
    .limit(MAX_THROTTLE_BUCKETS + 1);
  if (rows.length > MAX_THROTTLE_BUCKETS) {
    throw new SupportDashboardBoundsError();
  }
  const accountRows = rows.filter(({ kind }) => kind === "account");
  const ipRows = rows.filter(({ kind }) => kind === "ip");
  const activeAccountThrottleCount = accountRows.filter(
    ({ blockedUntil }) => blockedUntil !== null && blockedUntil > now,
  ).length;
  const activeIpThrottleCount = ipRows.filter(
    ({ blockedUntil }) => blockedUntil !== null && blockedUntil > now,
  ).length;
  const patterns = [];
  const repeatedAccounts = accountRows.filter(
    ({ failureCount }) => failureCount >= 5,
  );
  const repeatedIps = ipRows.filter(({ failureCount }) => failureCount >= 20);
  if (repeatedAccounts.length > 0) {
    patterns.push({
      count: repeatedAccounts.length,
      kind: "account_repeated_failures" as const,
      lastObservedAt: latestFailure(repeatedAccounts).toISOString(),
      severity: "warning" as const,
    });
  }
  if (repeatedIps.length > 0) {
    patterns.push({
      count: repeatedIps.length,
      kind: "ip_repeated_failures" as const,
      lastObservedAt: latestFailure(repeatedIps).toISOString(),
      severity: "warning" as const,
    });
  }
  if (activeAccountThrottleCount + activeIpThrottleCount > 0) {
    patterns.push({
      count: activeAccountThrottleCount + activeIpThrottleCount,
      kind: "active_cooldowns" as const,
      lastObservedAt: latestFailure(
        rows.filter(
          ({ blockedUntil }) => blockedUntil !== null && blockedUntil > now,
        ),
      ).toISOString(),
      severity: "notice" as const,
    });
  }
  return supportLoginSecuritySchema.parse({
    accountFailureBucketCount: accountRows.length,
    activeAccountThrottleCount,
    activeIpThrottleCount,
    checkedAt: now.toISOString(),
    ipFailureBucketCount: ipRows.length,
    lastFailureAt:
      rows.length === 0 ? null : latestFailure(rows).toISOString(),
    maxAccountFailureCount: maximumFailures(accountRows),
    maxIpFailureCount: maximumFailures(ipRows),
    patterns,
    windowHours: 24,
  });
}

async function loadIntegrity(
  database: AuthDatabase,
  now: Date,
  logger: AppLogger,
) {
  try {
    const result = await database.execute<{
      active_admin_count: number;
      approval_queue_mismatch_count: number;
      support_mfa_missing_count: number;
      support_staff_profile_count: number;
    }>(sql`
      select
        (
          select count(*)::int
          from user_capabilities capability
          join users account on account.id = capability.user_id
          where capability.capability = 'admin'
            and capability.is_active = true
            and account.is_active = true
        ) as active_admin_count,
        (
          select count(*)::int
          from approval_queue_entries queue
          join drafts draft on draft.id = queue.draft_id
          where queue.business_generation_id = current_business_state_generation_id()
            and queue.deleted_at is null
            and queue.status in ('pending', 'flagged')
            and (
              draft.business_generation_id <> current_business_state_generation_id()
              or draft.deleted_at is not null
              or draft.linked_queue_entry_id is distinct from queue.id
              or (queue.status = 'pending' and draft.status <> 'submitted')
              or (queue.status = 'flagged' and draft.status <> 'flagged')
            )
        ) as approval_queue_mismatch_count,
        (
          select count(*)::int
          from user_capabilities capability
          join users account on account.id = capability.user_id
          left join user_mfa_settings settings on settings.user_id = account.id
          where capability.capability = 'support_engineer'
            and capability.is_active = true
            and account.is_active = true
            and not (
              settings.enrollment_completed_at is not null
              and settings.recovery_codes_acknowledged_at is not null
              and exists (
                select 1 from user_mfa_methods method
                where method.user_id = account.id
                  and method.verified_at is not null
                  and method.disabled_at is null
                  and (method.expires_at is null or method.expires_at > ${now})
              )
              and exists (
                select 1 from user_mfa_recovery_codes recovery
                where recovery.user_id = account.id
              )
            )
        ) as support_mfa_missing_count,
        (
          select count(*)::int
          from user_capabilities capability
          join users account on account.id = capability.user_id
          join staff_profiles staff on staff.user_id = account.id
          where capability.capability = 'support_engineer'
            and capability.is_active = true
            and account.is_active = true
            and staff.is_active = true
        ) as support_staff_profile_count
    `);
    const counts = result.rows[0];
    if (counts === undefined) throw new Error("Integrity query returned no row");
    const warnings = [];
    if (counts.approval_queue_mismatch_count > 0) {
      warnings.push(integrityWarning(
        "approval_queue_state_mismatch",
        "critical",
        "Approval work is inconsistent with its source draft",
        counts.approval_queue_mismatch_count,
        now,
      ));
    }
    if (counts.support_staff_profile_count > 0) {
      warnings.push(integrityWarning(
        "support_staff_profile_present",
        "critical",
        "A support account also has an active staff profile",
        counts.support_staff_profile_count,
        now,
      ));
    }
    if (counts.support_mfa_missing_count > 0) {
      warnings.push(integrityWarning(
        "support_mfa_not_enrolled",
        "critical",
        "A support account has not completed MFA enrollment",
        counts.support_mfa_missing_count,
        now,
      ));
    }
    if (counts.active_admin_count < 2) {
      warnings.push(integrityWarning(
        "insufficient_recovery_administrators",
        "warning",
        "Fewer than two active recovery administrators are available",
        2 - counts.active_admin_count,
        now,
      ));
    }
    return supportIntegritySchema.parse({
      checkedAt: now.toISOString(),
      status: warnings.length === 0 ? "ok" : "warning",
      warnings,
    });
  } catch {
    logger.warn("Support integrity checks unavailable", {
      component: "support_dashboard",
      event: "support_integrity_check_failed",
    });
    return supportIntegritySchema.parse({
      checkedAt: now.toISOString(),
      status: "unavailable",
      warnings: [],
    });
  }
}

function integrityWarning(
  code: string,
  severity: "warning" | "critical",
  title: string,
  affectedCount: number,
  now: Date,
) {
  return {
    affectedCount,
    code,
    detectedAt: now.toISOString(),
    severity,
    title,
  };
}

function requireSupportAccess(context: AuthorizedRequestContext): void {
  if (!evaluateAccess(context.principal, SUPPORT_DASHBOARD_ACCESS).allowed) {
    throw new SupportDashboardAccessDeniedError();
  }
}

function elapsedMilliseconds(started: number, finished: number): number {
  if (!Number.isFinite(started) || !Number.isFinite(finished)) return 0;
  return Math.max(0, Math.min(60_000, Math.round(finished - started)));
}

function latestFailure(
  rows: readonly { lastFailedAt: Date }[],
): Date {
  const latest = rows.at(-1)?.lastFailedAt;
  if (latest === undefined) {
    throw new Error("A login-security pattern requires at least one row");
  }
  return latest;
}

function maximumFailures(rows: readonly { failureCount: number }[]): number {
  return rows.reduce(
    (maximum, { failureCount }) => Math.max(maximum, failureCount),
    0,
  );
}
