import { z } from "zod";
import {
  PAY_SHEET_ACCOUNT_BASES,
  PAY_SHEET_ADJUSTMENT_TYPES,
} from "./pay-sheet-adjustments.js";
import { ACCOUNT_ASSIGNMENTS } from "./policy-fields.js";
import { POLICY_TYPE_CLASSES } from "./policy-types.js";
import {
  PAY_SHEET_OWNER_TYPES,
  PAY_SHEET_STATUSES,
} from "./pay-sheets.js";

export const PAY_SHEET_STATUS_FILTERS = ["all", ...PAY_SHEET_STATUSES] as const;
export const PAY_SHEET_OWNER_FILTERS = ["all", ...PAY_SHEET_OWNER_TYPES] as const;

const uuidSchema = z.string().uuid();
const timestampSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.string().datetime(),
);
const dateSchema = z.string().date();
const moneySchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)\.[0-9]{2}$/);
const nonnegativeMoneySchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]*)\.[0-9]{2}$/);
const rateSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,2})\.[0-9]{2}$/)
  .refine((value) => Number(value) <= 100);

const nullablePeriodMonthQuerySchema = z.preprocess(
  (value) => (value === undefined ? null : value),
  z.union([z.null(), z.coerce.number().int().min(1).max(12)]),
);
const nullablePeriodYearQuerySchema = z.preprocess(
  (value) => (value === undefined ? null : value),
  z.union([z.null(), z.coerce.number().int().min(2000).max(9999)]),
);
const nullableOwnerQuerySchema = z.preprocess(
  (value) => (value === undefined ? null : value),
  uuidSchema.nullable(),
);

export const paySheetListQuerySchema = z
  .object({
    ownerType: z.enum(PAY_SHEET_OWNER_FILTERS).default("all"),
    ownerUserId: nullableOwnerQuerySchema.default(null),
    periodMonth: nullablePeriodMonthQuerySchema.default(null),
    periodYear: nullablePeriodYearQuerySchema.default(null),
    status: z.enum(PAY_SHEET_STATUS_FILTERS).default("all"),
  })
  .strict();

export const paySheetParamsSchema = z
  .object({ paySheetId: uuidSchema })
  .strict();

export const paySheetRateSchema = z
  .object({
    effectiveDate: dateSchema,
    newBrokerRate: rateSchema,
    newCommissionRate: rateSchema,
    renewalBrokerRate: rateSchema,
    renewalCommissionRate: rateSchema,
  })
  .strict();

export const paySheetSophiaTotalsSchema = z
  .object({
    brokerFees: moneySchema,
    commissions: moneySchema,
    directCheckAchIncome: moneySchema,
    grandTotalIncome: moneySchema,
    sophiaAgencyGross: moneySchema,
    sophiaShare: moneySchema,
    sophiaTakeHome: moneySchema,
    trustPull: moneySchema,
  })
  .strict();

export const paySheetProducerTotalsSchema = z
  .object({
    brokerFees: moneySchema,
    commissions: moneySchema,
    directCheckAchIncome: moneySchema,
    grandTotalIncome: moneySchema,
    producerPayout: moneySchema,
    trustPull: moneySchema,
  })
  .strict();

export const paySheetPolicyViewSchema = z
  .object({
    addedAt: timestampSchema,
    agencyRevenue: nonnegativeMoneySchema,
    associationId: uuidSchema,
    approvedAt: timestampSchema,
    brokerFee: nonnegativeMoneySchema,
    commissionAmount: nonnegativeMoneySchema,
    effectiveDate: dateSchema,
    insuredName: z.string().min(1).max(500),
    kayleeSplit: z.enum(ACCOUNT_ASSIGNMENTS),
    officeLocationId: uuidSchema,
    policyId: uuidSchema,
    policyNumber: z.string().min(1).max(100),
    policyTypeClass: z.enum(POLICY_TYPE_CLASSES),
    policyTypeName: z.string().min(1).max(200),
    producerDisplayName: z.string().min(1).nullable(),
    producerPayout: nonnegativeMoneySchema.nullable(),
    producerUserId: uuidSchema.nullable(),
    rate: paySheetRateSchema.nullable(),
    sophiaShare: nonnegativeMoneySchema,
    source: z.enum(["frozen", "live"]),
    transactionType: z.string().min(1).max(100),
  })
  .strict();

export const paySheetAdjustmentViewSchema = z
  .object({
    accountBasis: z.enum(PAY_SHEET_ACCOUNT_BASES),
    adjustmentType: z.enum(PAY_SHEET_ADJUSTMENT_TYPES),
    brokerFeeDelta: moneySchema,
    commissionDelta: moneySchema,
    createdAt: timestampSchema,
    createdByUserId: uuidSchema,
    effectiveDate: dateSchema,
    id: uuidSchema,
    incomeAmount: moneySchema,
    insuredOrClientLabel: z.string().min(1).max(500),
    paySheetId: uuidSchema,
    payoutDelta: moneySchema,
    policyTypeId: uuidSchema.nullable(),
    policyTypeName: z.string().min(1).max(200).nullable(),
    producerDisplayName: z.string().min(1).nullable(),
    producerUserId: uuidSchema.nullable(),
    reasonOrNote: z.string().min(1).max(2000).nullable(),
    sourceAdjustmentId: uuidSchema.nullable(),
    updatedAt: timestampSchema,
  })
  .strict();

const paySheetSummaryCommon = {
  adjustmentCount: z.number().int().nonnegative(),
  closedAt: timestampSchema.nullable(),
  closedByUserId: uuidSchema.nullable(),
  id: uuidSchema,
  openedAt: timestampSchema,
  ownerDisplayName: z.string().min(1),
  ownerUserId: uuidSchema,
  periodMonth: z.number().int().min(1).max(12),
  periodYear: z.number().int().min(2000).max(9999),
  policyCount: z.number().int().nonnegative(),
  status: z.enum(PAY_SHEET_STATUSES),
  updatedAt: timestampSchema,
} as const;

export const paySheetSophiaSummarySchema = z
  .object({
    ...paySheetSummaryCommon,
    closeBlocker: z.enum(["empty"]).nullable(),
    ownerType: z.literal("sophia"),
    totals: paySheetSophiaTotalsSchema,
  })
  .strict();

export const paySheetProducerSummarySchema = z
  .object({
    ...paySheetSummaryCommon,
    closeBlocker: z.enum(["empty", "missing_rate"]).nullable(),
    ownerType: z.literal("producer"),
    totals: paySheetProducerTotalsSchema.nullable(),
  })
  .strict();

const paySheetSummaryUnionSchema = z.discriminatedUnion("ownerType", [
  paySheetSophiaSummarySchema,
  paySheetProducerSummarySchema,
]);

export const paySheetSummarySchema = paySheetSummaryUnionSchema.superRefine(
  requireConsistentProducerTotals,
);

export const paySheetDetailSchema = z.discriminatedUnion("ownerType", [
  paySheetSophiaSummarySchema.extend({
    adjustments: z.array(paySheetAdjustmentViewSchema),
    policies: z.array(paySheetPolicyViewSchema),
  }),
  paySheetProducerSummarySchema.extend({
    adjustments: z.array(paySheetAdjustmentViewSchema),
    policies: z.array(paySheetPolicyViewSchema),
  }),
]).superRefine(requireConsistentProducerTotals);

export const paySheetListResponseSchema = z
  .object({
    items: z.array(paySheetSummarySchema),
    query: paySheetListQuerySchema,
  })
  .strict();

export const paySheetDetailResponseSchema = z
  .object({ sheet: paySheetDetailSchema })
  .strict();

export const paySheetBootstrapRequestSchema = z
  .object({
    periodMonth: z.number().int().min(1).max(12),
    periodYear: z.number().int().min(2000).max(9999),
  })
  .strict();

export const paySheetBootstrapResponseSchema = z
  .object({
    created: z.boolean(),
    sheet: paySheetSophiaSummarySchema,
  })
  .strict();

export const paySheetCloseRequestSchema = z
  .object({
    cascadeProducerSheets: z.boolean(),
  })
  .strict();

export const paySheetCloseResultSchema = z
  .object({
    closed: z.boolean(),
    nextSheetId: uuidSchema,
    ownerType: z.enum(PAY_SHEET_OWNER_TYPES),
    periodMonth: z.number().int().min(1).max(12),
    periodYear: z.number().int().min(2000).max(9999),
    policyCount: z.number().int().positive(),
  })
  .strict();

export const paySheetCloseOutcomeSchema = z
  .object({
    close: paySheetCloseResultSchema,
    closedSheet: paySheetDetailSchema,
    nextSheet: paySheetSummarySchema,
  })
  .strict()
  .superRefine(requireConsistentCloseOutcome);

export const paySheetCloseResponseSchema = z
  .object({
    close: paySheetCloseResultSchema,
    closedSheet: paySheetDetailSchema,
    nextSheet: paySheetSummarySchema,
    cascaded: z.array(paySheetCloseOutcomeSchema),
  })
  .strict()
  .superRefine(requireConsistentCloseOutcome);

export type PaySheetListQuery = z.output<typeof paySheetListQuerySchema>;
export type PaySheetRate = z.output<typeof paySheetRateSchema>;
export type PaySheetSophiaTotals = z.output<typeof paySheetSophiaTotalsSchema>;
export type PaySheetProducerTotals = z.output<typeof paySheetProducerTotalsSchema>;
export type PaySheetTotals = PaySheetSophiaTotals | PaySheetProducerTotals;
export type PaySheetPolicyView = z.output<typeof paySheetPolicyViewSchema>;
export type PaySheetAdjustmentView = z.output<typeof paySheetAdjustmentViewSchema>;
export type PaySheetSummary = z.output<typeof paySheetSummarySchema>;
export type PaySheetDetail = z.output<typeof paySheetDetailSchema>;
export type PaySheetListResponse = z.output<typeof paySheetListResponseSchema>;
export type PaySheetDetailResponse = z.output<typeof paySheetDetailResponseSchema>;
export type PaySheetBootstrapRequest = z.output<typeof paySheetBootstrapRequestSchema>;
export type PaySheetBootstrapResponse = z.output<typeof paySheetBootstrapResponseSchema>;
export type PaySheetCloseResult = z.output<typeof paySheetCloseResultSchema>;
export type PaySheetCloseOutcome = z.output<typeof paySheetCloseOutcomeSchema>;
export type PaySheetCloseResponse = z.output<typeof paySheetCloseResponseSchema>;

function requireConsistentCloseOutcome(
  value: {
    close: z.output<typeof paySheetCloseResultSchema>;
    closedSheet: z.output<typeof paySheetDetailSchema>;
    nextSheet: z.output<typeof paySheetSummarySchema>;
  },
  context: z.RefinementCtx,
): void {
  const nextPeriod =
    value.close.periodMonth === 12
      ? { month: 1, year: value.close.periodYear + 1 }
      : {
          month: value.close.periodMonth + 1,
          year: value.close.periodYear,
        };
  if (
    value.closedSheet.id === value.close.nextSheetId ||
    value.closedSheet.ownerType !== value.close.ownerType ||
    value.closedSheet.ownerUserId !== value.nextSheet.ownerUserId ||
    value.closedSheet.periodMonth !== value.close.periodMonth ||
    value.closedSheet.periodYear !== value.close.periodYear ||
    value.closedSheet.policyCount !== value.close.policyCount ||
    value.closedSheet.policies.length !== value.close.policyCount ||
    value.closedSheet.status !== "closed" ||
    value.nextSheet.id !== value.close.nextSheetId ||
    value.nextSheet.ownerType !== value.close.ownerType ||
    value.nextSheet.periodMonth !== nextPeriod.month ||
    value.nextSheet.periodYear !== nextPeriod.year ||
    value.nextSheet.status !== "open"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Pay-sheet close response is inconsistent",
    });
  }
}

function requireConsistentProducerTotals(
  value: { closeBlocker: string | null; ownerType: string; totals: unknown },
  context: z.RefinementCtx,
): void {
  if (
    value.ownerType === "producer" &&
    (value.closeBlocker === "missing_rate") !== (value.totals === null)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Missing producer rates require unavailable totals",
      path: ["totals"],
    });
  }
}
