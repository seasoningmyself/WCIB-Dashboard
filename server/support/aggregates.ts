import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { AuthDatabase } from "../auth/users.js";
import { inActiveBusinessGeneration } from "../db/business-state.js";
import {
  auditEvents,
  paySheetPolicies,
  paySheets,
} from "../db/schema.js";
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
  supportDashboardQuerySchema,
  supportKpiCalculationSchema,
  type SupportAuditActivity,
  type SupportAuditCategory,
  type SupportDashboardQuery,
  type SupportKpiCalculation,
} from "../../shared/support-dashboard.js";
import { SupportDashboardBoundsError } from "./errors.js";
import type { AuditAction } from "../../shared/audit-events.js";

const MAX_COMPANY_FACTS = 100_000;
const MAX_REPORTING_PERIOD_ROWS = 24;
const AUDIT_WINDOW_MS = 24 * 60 * 60 * 1_000;

interface NormalizedSupportQuery {
  period: KpiActualPeriod;
  year: number;
}

interface CompanyAggregateGroup {
  newPolicyCount: number;
  policyCount: number;
}

interface CompanyReportingPeriodSource {
  month: number;
  recordCount: number;
  status: "open" | "closed";
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

export async function loadSupportKpiCalculation(
  database: AuthDatabase,
  rawQuery: unknown,
  now: Date,
): Promise<SupportKpiCalculation> {
  const query = normalizeQuery(supportDashboardQuerySchema.parse(rawQuery), now);
  const months = KPI_PERIOD_MONTHS[query.period];
  const [facts, reportingPeriods] = await database.transaction(
    async (transaction) =>
      Promise.all([
        listClosedKpiFacts(transaction as KpiFactDatabase, {
          periodMonths: months,
          scopeType: "company",
          year: query.year,
        }),
        transaction
          .select({
            month: paySheets.periodMonth,
            recordCount: sql<number>`count(${paySheetPolicies.id})::integer`,
            status: paySheets.status,
          })
          .from(paySheets)
          .leftJoin(
            paySheetPolicies,
            and(
              eq(paySheetPolicies.paySheetId, paySheets.id),
              inActiveBusinessGeneration(
                paySheetPolicies.businessGenerationId,
              ),
            ),
          )
          .where(
            and(
              eq(paySheets.ownerType, "sophia"),
              eq(paySheets.periodYear, query.year),
              inArray(paySheets.periodMonth, months),
              inActiveBusinessGeneration(paySheets.businessGenerationId),
            ),
          )
          .groupBy(paySheets.id)
          .orderBy(paySheets.periodMonth, paySheets.id)
          .limit(MAX_REPORTING_PERIOD_ROWS + 1),
      ]),
    { accessMode: "read only", isolationLevel: "repeatable read" },
  );
  if (
    facts.length > MAX_COMPANY_FACTS ||
    reportingPeriods.length > MAX_REPORTING_PERIOD_ROWS
  ) {
    throw new SupportDashboardBoundsError();
  }
  return buildSupportKpiCalculation(query, facts, reportingPeriods, now);
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

export function buildSupportKpiCalculation(
  query: Readonly<NormalizedSupportQuery>,
  facts: readonly ClosedKpiFact[],
  reportingPeriods: readonly CompanyReportingPeriodSource[],
  calculatedAt: Date,
): SupportKpiCalculation {
  if (Number.isNaN(calculatedAt.getTime())) {
    throw new SupportDashboardBoundsError();
  }
  const months = KPI_PERIOD_MONTHS[query.period];
  const monthly = new Map<number, CompanyAggregateGroup>(
    months.map((month) => [
      month,
      { newPolicyCount: 0, policyCount: 0 },
    ]),
  );
  let newPolicyCount = 0;
  let wonBackCount = 0;

  for (const fact of facts) {
    const group = monthly.get(fact.periodMonth);
    if (group === undefined || fact.periodYear !== query.year) {
      throw new SupportDashboardBoundsError();
    }
    const isNew = fact.snapshot.transactionType === "New";
    group.policyCount += 1;
    if (isNew) {
      newPolicyCount += 1;
      group.newPolicyCount += 1;
    }
    if (fact.snapshot.transactionType === "Won Back") {
      wonBackCount += 1;
    }
  }

  const periodRows = new Map<number, CompanyReportingPeriodSource[]>();
  for (const period of reportingPeriods) {
    if (
      !months.includes(period.month) ||
      !Number.isInteger(period.recordCount) ||
      period.recordCount < 0
    ) {
      throw new SupportDashboardBoundsError();
    }
    const rows = periodRows.get(period.month) ?? [];
    rows.push(period);
    periodRows.set(period.month, rows);
  }

  const mismatchedMonths = new Set<number>();
  const monthlyResponse = months.map((month) => {
    const group = monthly.get(month);
    if (group === undefined) throw new SupportDashboardBoundsError();
    const rows = periodRows.get(month) ?? [];
    const closedRows = rows.filter(({ status }) => status === "closed");
    const closedRecordCount = closedRows.reduce(
      (total, row) => total + row.recordCount,
      0,
    );
    if (rows.length > 1 || closedRecordCount !== group.policyCount) {
      mismatchedMonths.add(month);
    }
    const due = isPastReportingPeriod(query.year, month, calculatedAt);
    const reportingStatus =
      rows.length === 1 && closedRows.length === 1
        ? "complete"
        : due
          ? rows.length === 0
            ? "missing"
            : "incomplete"
          : "not_due";
    return {
      month,
      newPolicyCount: group.newPolicyCount,
      policyCount: group.policyCount,
      reportingStatus,
    } as const;
  });

  const policyCount = facts.length;
  if (
    monthlyResponse.reduce((total, month) => total + month.policyCount, 0) !==
      policyCount ||
    monthlyResponse.reduce(
      (total, month) => total + month.newPolicyCount,
      0,
    ) !== newPolicyCount
  ) {
    for (const month of months) mismatchedMonths.add(month);
  }
  const missingOrIncompletePeriods = monthlyResponse.flatMap((month) =>
    month.reportingStatus === "missing" ||
    month.reportingStatus === "incomplete"
      ? [{ month: month.month, status: month.reportingStatus }]
      : [],
  );
  const anomalyMonths = [
    ...mismatchedMonths,
    ...missingOrIncompletePeriods.map(({ month }) => month),
  ].sort((left, right) => left - right);
  const reconciliationVariance =
    mismatchedMonths.size === 0 ? "none" : "detected";
  const status =
    reconciliationVariance === "detected"
      ? "mismatched"
      : missingOrIncompletePeriods.length > 0
        ? "stale"
        : "healthy";

  return supportKpiCalculationSchema.parse({
    firstAnomalyMonth: anomalyMonths[0] ?? null,
    lastSuccessfulCalculationAt: calculatedAt.toISOString(),
    missingOrIncompletePeriods,
    monthly: monthlyResponse,
    period: query.period,
    reconciliationVariance,
    recordsProcessed: policyCount,
    source: "closed_pay_sheets",
    status,
    totals: {
      newPolicyCount,
      policyCount,
      retentionRate:
        policyCount === 0
          ? null
          : formatRate(policyCount - newPolicyCount, policyCount),
      wonBackCount,
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

function formatRate(numerator: number, denominator: number): string {
  const hundredths =
    (BigInt(numerator) * 10_000n + BigInt(Math.floor(denominator / 2))) /
    BigInt(denominator);
  return `${hundredths / 100n}.${(hundredths % 100n)
    .toString()
    .padStart(2, "0")}`;
}

function isPastReportingPeriod(
  year: number,
  month: number,
  now: Date,
): boolean {
  return (
    year < now.getUTCFullYear() ||
    (year === now.getUTCFullYear() && month < now.getUTCMonth() + 1)
  );
}

function normalizeTimestamp(value: Date | string): Date {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new SupportDashboardBoundsError();
  return timestamp;
}
