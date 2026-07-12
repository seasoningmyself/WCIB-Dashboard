import { z } from "zod";
import { KPI_TARGET_SCOPE_TYPES } from "./kpi-targets.js";

export const KPI_ACTUAL_PERIODS = ["full", "Q1", "Q2", "Q3", "Q4"] as const;
export const KPI_PERIOD_MONTHS = Object.freeze({
  full: Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  Q1: Object.freeze([1, 2, 3]),
  Q2: Object.freeze([4, 5, 6]),
  Q3: Object.freeze([7, 8, 9]),
  Q4: Object.freeze([10, 11, 12]),
}) satisfies Readonly<Record<KpiActualPeriod, readonly number[]>>;

const uuidSchema = z.string().uuid();
const yearSchema = z.coerce.number().int().min(2000).max(9999);
const countSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const moneySchema = z.string().regex(/^(?:0|[1-9][0-9]{0,14})\.[0-9]{2}$/);
const rateSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]?|100)\.[0-9]{2}$/)
  .refine((value) => Number(value) <= 100);
const labelSchema = z.string().trim().min(1).max(500);

export const kpiActualPeriodSchema = z.enum(KPI_ACTUAL_PERIODS);
export const kpiActualScopeTypeSchema = z.enum(KPI_TARGET_SCOPE_TYPES);

export const kpiActualQuerySchema = z
  .object({
    period: kpiActualPeriodSchema,
    producerUserId: uuidSchema.optional(),
    scopeType: kpiActualScopeTypeSchema,
    year: yearSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.scopeType === "company" && value.producerUserId !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Company KPI scope cannot include a producer",
        path: ["producerUserId"],
      });
    }
    if (value.scopeType === "producer" && value.producerUserId === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Producer KPI scope requires a producer UUID",
        path: ["producerUserId"],
      });
    }
  });

const kpiActualTotalsSchema = z
  .object({
    agencyRevenue: moneySchema,
    existingPolicyCount: countSchema,
    newPolicyCount: countSchema,
    newRevenue: moneySchema,
    policyCount: countSchema,
    producerBookPayout: moneySchema,
    producerFirstYearHousePayout: moneySchema,
    producerPayout: moneySchema,
    retentionRate: rateSchema.nullable(),
    wonBackCount: countSchema,
    wonBackRevenue: moneySchema,
  })
  .strict();

const kpiActualMonthlySchema = z
  .object({
    agencyRevenue: moneySchema,
    month: z.number().int().min(1).max(12),
    newPolicyCount: countSchema,
    policyCount: countSchema,
    producerPayout: moneySchema,
  })
  .strict();

const kpiActualTransactionTypeSchema = z
  .object({
    agencyRevenue: moneySchema,
    policyCount: countSchema,
    transactionType: labelSchema,
  })
  .strict();

const kpiActualOfficeSchema = z
  .object({
    agencyRevenue: moneySchema,
    displayName: labelSchema,
    newPolicyCount: countSchema,
    officeLocationId: uuidSchema,
    policyCount: countSchema,
  })
  .strict();

const kpiActualProducerPayoutSchema = z
  .object({
    bookPayout: moneySchema,
    displayName: labelSchema,
    firstYearHousePayout: moneySchema,
    policyCount: countSchema,
    producerUserId: uuidSchema,
    totalPayout: moneySchema,
  })
  .strict();

export const kpiActualResponseSchema = z
  .object({
    empty: z.boolean(),
    monthly: z.array(kpiActualMonthlySchema).max(12),
    offices: z.array(kpiActualOfficeSchema).max(500),
    period: kpiActualPeriodSchema,
    producerPayouts: z.array(kpiActualProducerPayoutSchema).max(500),
    scope: z
      .object({
        displayName: labelSchema.nullable(),
        producerUserId: uuidSchema.nullable(),
        scopeType: kpiActualScopeTypeSchema,
      })
      .strict(),
    totals: kpiActualTotalsSchema,
    transactionTypes: z.array(kpiActualTransactionTypeSchema).max(100),
    year: yearSchema,
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
        message: "KPI monthly series must match the selected period",
        path: ["monthly"],
      });
    }
    if (
      (value.scope.scopeType === "company" &&
        (value.scope.producerUserId !== null || value.scope.displayName !== null)) ||
      (value.scope.scopeType === "producer" &&
        (value.scope.producerUserId === null || value.scope.displayName === null))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "KPI actual scope shape is invalid",
        path: ["scope"],
      });
    }
  });

export type KpiActualPeriod = (typeof KPI_ACTUAL_PERIODS)[number];
export type KpiActualQuery = z.output<typeof kpiActualQuerySchema>;
export type KpiActualResponse = z.output<typeof kpiActualResponseSchema>;
