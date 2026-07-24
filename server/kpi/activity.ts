import { and, desc, eq, isNull } from "drizzle-orm";
import {
  kpiRecentActivityResponseSchema,
  KPI_RECENT_ACTIVITY_LIMIT,
  type KpiRecentActivityResponse,
} from "../../shared/kpi-activity.js";
import { evaluateAccess } from "../auth/access.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { inActiveBusinessGeneration } from "../db/business-state.js";
import {
  auditEvents,
  paySheets,
  policies,
  users,
} from "../db/schema.js";
import {
  KPI_ADMIN_ACCESS,
  KpiTargetAccessDeniedError,
} from "./targets.js";

export interface KpiRecentActivitySourceItem {
  actionType: "pay_sheet_closed" | "policy_approved";
  actorDisplayName: string;
  occurredAt: Date;
  targetReference: string;
}

export interface KpiRecentActivitySource {
  activities: readonly KpiRecentActivitySourceItem[];
}

export async function loadKpiRecentActivitySource(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
): Promise<KpiRecentActivitySource> {
  requireKpiAdmin(context);

  const [policyEvents, paySheetEvents] = await Promise.all([
    database
      .select({
        actorDisplayName: users.displayName,
        occurredAt: auditEvents.occurredAt,
        policyNumber: policies.policyNumber,
      })
      .from(auditEvents)
      .innerJoin(users, eq(users.id, auditEvents.actorUserId))
      .innerJoin(
        policies,
        and(
          eq(auditEvents.entityType, "policy"),
          eq(policies.id, auditEvents.entityId),
        ),
      )
      .where(
        and(
          eq(auditEvents.action, "policy_approved"),
          inActiveBusinessGeneration(policies.businessGenerationId),
          isNull(policies.deletedAt),
        ),
      )
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(KPI_RECENT_ACTIVITY_LIMIT),
    database
      .select({
        actorDisplayName: users.displayName,
        occurredAt: auditEvents.occurredAt,
        periodMonth: paySheets.periodMonth,
        periodYear: paySheets.periodYear,
      })
      .from(auditEvents)
      .innerJoin(users, eq(users.id, auditEvents.actorUserId))
      .innerJoin(
        paySheets,
        and(
          eq(auditEvents.entityType, "pay_sheet"),
          eq(paySheets.id, auditEvents.entityId),
        ),
      )
      .where(
        and(
          eq(auditEvents.action, "pay_sheet_closed"),
          eq(paySheets.status, "closed"),
          inActiveBusinessGeneration(paySheets.businessGenerationId),
        ),
      )
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(KPI_RECENT_ACTIVITY_LIMIT),
  ]);

  const activities = [
    ...policyEvents.map((event): KpiRecentActivitySourceItem => ({
      actionType: "policy_approved",
      actorDisplayName: event.actorDisplayName,
      occurredAt: event.occurredAt,
      targetReference: `Policy ${event.policyNumber}`,
    })),
    ...paySheetEvents.map((event): KpiRecentActivitySourceItem => ({
      actionType: "pay_sheet_closed",
      actorDisplayName: event.actorDisplayName,
      occurredAt: event.occurredAt,
      targetReference: `Pay sheet ${monthName(event.periodMonth)} ${event.periodYear}`,
    })),
  ]
    .sort(
      (left, right) =>
        right.occurredAt.getTime() - left.occurredAt.getTime(),
    )
    .slice(0, KPI_RECENT_ACTIVITY_LIMIT);

  return Object.freeze({ activities: Object.freeze(activities) });
}

export function projectAdminKpiRecentActivitySource(
  source: Readonly<KpiRecentActivitySource>,
  context: AuthorizedRequestContext,
): KpiRecentActivityResponse | null {
  if (!evaluateAccess(context.principal, KPI_ADMIN_ACCESS).allowed) return null;
  return kpiRecentActivityResponseSchema.parse({
    activities: source.activities,
  });
}

function requireKpiAdmin(context: AuthorizedRequestContext): void {
  if (!evaluateAccess(context.principal, KPI_ADMIN_ACCESS).allowed) {
    throw new KpiTargetAccessDeniedError();
  }
}

function monthName(month: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2000, month - 1, 1)));
}
