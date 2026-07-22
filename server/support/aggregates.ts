import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { AuthDatabase } from "../auth/users.js";
import { inActiveBusinessGeneration } from "../db/business-state.js";
import { auditEvents, kpiTargets } from "../db/schema.js";
import {
  listClosedKpiFacts,
  type ClosedKpiFact,
  type KpiFactDatabase,
} from "../kpi/closed-facts.js";
import {
  KPI_PERIOD_MONTHS,
  type KpiActualPeriod,
} from "../../shared/kpi-actuals.js";
import {
  SUPPORT_AUDIT_CATEGORIES,
  supportAuditActivitySchema,
  supportCompanyNumbersSchema,
  supportDashboardQuerySchema,
  type SupportAuditActivity,
  type SupportAuditCategory,
  type SupportCompanyNumbers,
  type SupportDashboardQuery,
} from "../../shared/support-dashboard.js";
import { SupportDashboardBoundsError } from "./errors.js";
import type { AuditAction } from "../../shared/audit-events.js";

const MAX_COMPANY_FACTS = 100_000;
const AUDIT_WINDOW_MS = 24 * 60 * 60 * 1_000;
const moneyPattern = /^(0|[1-9][0-9]{0,11})\.([0-9]{2})$/;

interface CompanyTarget {
  newPolicyCount: number | null;
  newRevenue: string | null;
  retentionRate: string | null;
}

interface NormalizedSupportQuery {
  period: KpiActualPeriod;
  year: number;
}

interface CompanyAggregateGroup {
  agencyRevenueCents: bigint;
  newPolicyCount: number;
  policyCount: number;
}

export const AUDIT_CATEGORY_BY_ACTION = {
  policy_override_applied: "financial_workflow",
  mga_payment_marked_paid: "financial_workflow",
  mga_payment_marked_unpaid: "financial_workflow",
  mga_payment_sheet_attached: "financial_workflow",
  mga_payment_sheet_detached: "financial_workflow",
  pay_sheet_closed: "financial_workflow",
  pay_sheet_adjustment_created: "financial_workflow",
  pay_sheet_adjustment_updated: "financial_workflow",
  pay_sheet_adjustment_deleted: "financial_workflow",
  staff_account_changed: "access_control",
  producer_rate_changed: "financial_workflow",
  draft_submitted: "business_workflow",
  draft_submission_withdrawn: "business_workflow",
  draft_flagged: "business_workflow",
  draft_help_withdrawn: "business_workflow",
  draft_sent_back: "business_workflow",
  policy_approved: "business_workflow",
  admin_policy_submitted: "business_workflow",
  policy_corrected: "business_workflow",
  carrier_created: "system_maintenance",
  policy_type_created: "system_maintenance",
  mga_created: "system_maintenance",
  producer_commission_receipt_marked: "financial_workflow",
  producer_commission_receipt_unmarked: "financial_workflow",
  pay_sheet_initialized: "financial_workflow",
  policy_change_request_created: "business_workflow",
  policy_change_request_corrected: "business_workflow",
  policy_change_request_resolved_as_is: "business_workflow",
  policy_change_request_sent_back: "business_workflow",
  policy_soft_deleted: "business_workflow",
  policy_restored: "business_workflow",
  approval_work_soft_deleted: "business_workflow",
  approval_work_restored: "business_workflow",
  business_state_reset: "system_maintenance",
  business_state_restored: "system_maintenance",
  policy_ipfs_pushed: "business_workflow",
  policy_ipfs_unpushed: "business_workflow",
  vocabulary_deactivated: "system_maintenance",
  vocabulary_reactivated: "system_maintenance",
  user_password_changed: "authentication",
  user_profile_changed: "access_control",
  user_temporary_password_issued: "authentication",
  user_mfa_enrolled: "mfa",
  user_mfa_method_added: "mfa",
  user_mfa_method_renamed: "mfa",
  user_mfa_method_removed: "mfa",
  user_mfa_recovery_code_used: "mfa",
  user_mfa_recovery_codes_regenerated: "mfa",
  user_mfa_challenge_succeeded: "mfa",
  user_mfa_challenge_failed: "mfa",
  user_mfa_step_up_succeeded: "mfa",
  user_mfa_step_up_failed: "mfa",
  user_mfa_disabled: "mfa",
  user_mfa_reset: "mfa",
  user_admin_capability_changed: "access_control",
  user_support_capability_changed: "access_control",
  support_surface_viewed: "access_control",
  office_location_created: "system_maintenance",
  office_location_renamed: "system_maintenance",
  office_location_deactivated: "system_maintenance",
  office_location_reactivated: "system_maintenance",
} as const satisfies Record<AuditAction, SupportAuditCategory>;

export async function loadSupportCompanyNumbers(
  database: AuthDatabase,
  rawQuery: unknown,
  now: Date,
): Promise<SupportCompanyNumbers> {
  const query = normalizeQuery(supportDashboardQuerySchema.parse(rawQuery), now);
  const [facts, targetRows] = await Promise.all([
    listClosedKpiFacts(database as KpiFactDatabase, {
      periodMonths: KPI_PERIOD_MONTHS[query.period],
      scopeType: "company",
      year: query.year,
    }),
    database
      .select({
        newPolicyCount: kpiTargets.newPolicyCountTarget,
        newRevenue: kpiTargets.newRevenueTarget,
        retentionRate: kpiTargets.retentionRateTarget,
      })
      .from(kpiTargets)
      .where(
        and(
          eq(kpiTargets.scopeType, "company"),
          eq(kpiTargets.year, query.year),
          inActiveBusinessGeneration(kpiTargets.businessGenerationId),
        ),
      )
      .limit(2),
  ]);
  if (facts.length > MAX_COMPANY_FACTS || targetRows.length > 1) {
    throw new SupportDashboardBoundsError();
  }
  return buildSupportCompanyNumbers(query, facts, targetRows[0] ?? null);
}

export async function loadSupportAuditActivity(
  database: AuthDatabase,
  now: Date,
): Promise<SupportAuditActivity> {
  const windowStart = new Date(now.getTime() - AUDIT_WINDOW_MS);
  const rows = await database
    .select({
      action: auditEvents.action,
      count: sql<number>`count(*)::integer`,
      lastOccurredAt: sql<Date | string>`max(${auditEvents.occurredAt})`,
    })
    .from(auditEvents)
    .where(
      and(
        gte(auditEvents.occurredAt, windowStart),
        lte(auditEvents.occurredAt, now),
      ),
    )
    .groupBy(auditEvents.action);

  const byCategory = new Map<
    SupportAuditCategory,
    { count: number; lastOccurredAt: Date | null }
  >(
    SUPPORT_AUDIT_CATEGORIES.map((type) => [
      type,
      { count: 0, lastOccurredAt: null },
    ]),
  );
  for (const row of rows) {
    const category = AUDIT_CATEGORY_BY_ACTION[row.action];
    const current = byCategory.get(category);
    if (current === undefined) throw new SupportDashboardBoundsError();
    const lastOccurredAt = normalizeTimestamp(row.lastOccurredAt);
    current.count += row.count;
    if (
      current.lastOccurredAt === null ||
      lastOccurredAt > current.lastOccurredAt
    ) {
      current.lastOccurredAt = lastOccurredAt;
    }
  }
  const latestEventAt = [...byCategory.values()].reduce<Date | null>(
    (latest, value) =>
      value.lastOccurredAt !== null &&
      (latest === null || value.lastOccurredAt > latest)
        ? value.lastOccurredAt
        : latest,
    null,
  );
  return supportAuditActivitySchema.parse({
    categories: SUPPORT_AUDIT_CATEGORIES.map((type) => {
      const value = byCategory.get(type);
      if (value === undefined) throw new SupportDashboardBoundsError();
      return {
        count: value.count,
        lastOccurredAt: value.lastOccurredAt?.toISOString() ?? null,
        type,
      };
    }),
    latestEventAt: latestEventAt?.toISOString() ?? null,
    totalEventCount: rows.reduce((total, row) => total + row.count, 0),
    windowEnd: now.toISOString(),
    windowStart: windowStart.toISOString(),
  });
}

export function buildSupportCompanyNumbers(
  query: Readonly<NormalizedSupportQuery>,
  facts: readonly ClosedKpiFact[],
  target: Readonly<CompanyTarget> | null,
): SupportCompanyNumbers {
  const months = KPI_PERIOD_MONTHS[query.period];
  const monthly = new Map<number, CompanyAggregateGroup>(
    months.map((month) => [
      month,
      { agencyRevenueCents: 0n, newPolicyCount: 0, policyCount: 0 },
    ]),
  );
  let agencyRevenueCents = 0n;
  let newPolicyCount = 0;
  let newRevenueCents = 0n;
  let wonBackCount = 0;
  let wonBackRevenueCents = 0n;
  let asOf: Date | null = null;

  for (const fact of facts) {
    const group = monthly.get(fact.periodMonth);
    if (group === undefined || fact.periodYear !== query.year) {
      throw new SupportDashboardBoundsError();
    }
    const revenueCents = parseMoney(fact.snapshot.agencyRevenue);
    const isNew = fact.snapshot.transactionType === "New";
    agencyRevenueCents += revenueCents;
    group.agencyRevenueCents += revenueCents;
    group.policyCount += 1;
    if (isNew) {
      newPolicyCount += 1;
      newRevenueCents += revenueCents;
      group.newPolicyCount += 1;
    }
    if (fact.snapshot.transactionType === "Won Back") {
      wonBackCount += 1;
      wonBackRevenueCents += revenueCents;
    }
    if (asOf === null || fact.closedAt > asOf) asOf = fact.closedAt;
  }

  const policyCount = facts.length;
  return supportCompanyNumbersSchema.parse({
    asOf: asOf?.toISOString() ?? null,
    empty: policyCount === 0,
    monthly: months.map((month) => {
      const group = monthly.get(month);
      if (group === undefined) throw new SupportDashboardBoundsError();
      return {
        agencyRevenue: formatMoney(group.agencyRevenueCents),
        month,
        newPolicyCount: group.newPolicyCount,
        policyCount: group.policyCount,
      };
    }),
    period: query.period,
    source: "closed_pay_sheets",
    targets: {
      newPolicyCount: target?.newPolicyCount ?? null,
      newRevenue: target?.newRevenue ?? null,
      retentionRate: target?.retentionRate ?? null,
    },
    totals: {
      agencyRevenue: formatMoney(agencyRevenueCents),
      existingPolicyCount: policyCount - newPolicyCount,
      newPolicyCount,
      newRevenue: formatMoney(newRevenueCents),
      policyCount,
      retentionRate:
        policyCount === 0
          ? null
          : formatRate(policyCount - newPolicyCount, policyCount),
      wonBackCount,
      wonBackRevenue: formatMoney(wonBackRevenueCents),
    },
    year: query.year,
  });
}

function normalizeQuery(
  query: SupportDashboardQuery,
  now: Date,
): NormalizedSupportQuery {
  return {
    period: query.period ?? "full",
    year: query.year ?? now.getUTCFullYear(),
  };
}

function parseMoney(value: string): bigint {
  const match = moneyPattern.exec(value);
  if (match === null) throw new SupportDashboardBoundsError();
  return BigInt(match[1] ?? "0") * 100n + BigInt(match[2] ?? "0");
}

function formatMoney(cents: bigint): string {
  if (cents < 0n) throw new SupportDashboardBoundsError();
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

function formatRate(numerator: number, denominator: number): string {
  const hundredths =
    (BigInt(numerator) * 10_000n + BigInt(Math.floor(denominator / 2))) /
    BigInt(denominator);
  return `${hundredths / 100n}.${(hundredths % 100n)
    .toString()
    .padStart(2, "0")}`;
}

function normalizeTimestamp(value: Date | string): Date {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new SupportDashboardBoundsError();
  return timestamp;
}
