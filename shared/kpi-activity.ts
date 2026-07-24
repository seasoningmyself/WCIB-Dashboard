import { z } from "zod";

export const KPI_RECENT_ACTIVITY_LIMIT = 8;

export const KPI_RECENT_ACTIVITY_ACTIONS = [
  "pay_sheet_closed",
  "policy_approved",
] as const;

const apiTimestampSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.string().datetime(),
);

export const kpiRecentActivityItemSchema = z
  .object({
    actionType: z.enum(KPI_RECENT_ACTIVITY_ACTIONS),
    actorDisplayName: z.string().trim().min(1).max(200),
    occurredAt: apiTimestampSchema,
    targetReference: z.string().trim().min(1).max(240),
  })
  .strict();

export const kpiRecentActivityResponseSchema = z
  .object({
    activities: z
      .array(kpiRecentActivityItemSchema)
      .max(KPI_RECENT_ACTIVITY_LIMIT),
  })
  .strict();

export type KpiRecentActivityItem = z.output<
  typeof kpiRecentActivityItemSchema
>;
export type KpiRecentActivityResponse = z.output<
  typeof kpiRecentActivityResponseSchema
>;
