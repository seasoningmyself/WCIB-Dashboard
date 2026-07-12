import { z } from "zod";

export const MY_COMMISSION_SECTIONS = ["owed", "in_review", "paid"] as const;
export const MY_COMMISSION_STATUSES = [
  "awaiting_payment",
  "pending_approval",
  "received",
] as const;
export const MY_COMMISSION_SORTS = ["insured", "account"] as const;

const apiTimestampSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.string().datetime(),
);
const moneySchema = z.string().regex(/^(0|[1-9][0-9]*)\.[0-9]{2}$/);

export const myCommissionsListQuerySchema = z
  .object({
    search: z
      .string()
      .trim()
      .max(200)
      .default(""),
    sort: z.enum(MY_COMMISSION_SORTS).default("insured"),
  })
  .strict();

export const myCommissionItemSchema = z
  .object({
    estimate: z.boolean(),
    id: z.string().uuid(),
    insuredName: z.string().min(1),
    payout: moneySchema.nullable(),
    policyType: z.string().min(1),
    receivedAt: apiTimestampSchema.nullable(),
    section: z.enum(MY_COMMISSION_SECTIONS),
    status: z.enum(MY_COMMISSION_STATUSES),
    transactionType: z.string().min(1),
  })
  .strict();

export const myCommissionsSummarySchema = z
  .object({
    inReviewCount: z.number().int().nonnegative(),
    owedAmount: moneySchema.nullable(),
    owedCount: z.number().int().nonnegative(),
    paidLast30DaysAmount: moneySchema.nullable(),
    paidLast30DaysCount: z.number().int().nonnegative(),
  })
  .strict();

export const myCommissionsResponseSchema = z
  .object({
    items: z.array(myCommissionItemSchema),
    summary: myCommissionsSummarySchema,
  })
  .strict();

export const myCommissionReceiptParamsSchema = z
  .object({ policyId: z.string().uuid() })
  .strict();

export const myCommissionReceiptRequestSchema = z
  .object({ received: z.boolean() })
  .strict();

export type MyCommissionItem = z.output<typeof myCommissionItemSchema>;
export type MyCommissionsListQuery = z.output<
  typeof myCommissionsListQuerySchema
>;
export type MyCommissionsResponse = z.output<
  typeof myCommissionsResponseSchema
>;
export type MyCommissionsSummary = z.output<
  typeof myCommissionsSummarySchema
>;
export type MyCommissionReceiptRequest = z.output<
  typeof myCommissionReceiptRequestSchema
>;
