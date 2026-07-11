import { z } from "zod";
import { ACCOUNT_ASSIGNMENTS } from "./policy-fields.js";
import { MGA_PAYMENT_STATUSES } from "./mga-payments.js";

export const MGA_PAYABLE_FILTERS = ["unpaid", "all", "paid"] as const;

export const mgaPayableListQuerySchema = z
  .object({
    status: z.enum(MGA_PAYABLE_FILTERS).default("unpaid"),
  })
  .strict();

const apiTimestampSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.string().datetime(),
);

const moneySchema = z.string().regex(/^(0|[1-9][0-9]*)\.[0-9]{2}$/);

export const mgaPayableItemSchema = z
  .object({
    accountAssignment: z.enum(ACCOUNT_ASSIGNMENTS),
    approvedAt: apiTimestampSchema,
    insuredName: z.string(),
    kayleeSplit: z.enum(ACCOUNT_ASSIGNMENTS),
    mgaId: z.string().uuid(),
    mgaName: z.string(),
    netDue: moneySchema,
    overridden: z.boolean(),
    paidAt: apiTimestampSchema.nullable(),
    paymentReference: z.string().nullable(),
    policyId: z.string().uuid(),
    policyNumber: z.string(),
    policyTypeName: z.string(),
    producerDisplayName: z.string().nullable(),
    producerUserId: z.string().uuid().nullable(),
    status: z.enum(MGA_PAYMENT_STATUSES),
    transactionType: z.string(),
  })
  .strict();

export const mgaPayableTotalsSchema = z
  .object({
    outstandingAmount: moneySchema,
    paidAmount: moneySchema,
    paidCount: z.number().int().nonnegative(),
    totalCount: z.number().int().nonnegative(),
    unpaidCount: z.number().int().nonnegative(),
  })
  .strict();

export const mgaPayableGroupSchema = z
  .object({
    items: z.array(mgaPayableItemSchema),
    mgaId: z.string().uuid(),
    mgaName: z.string(),
    totals: mgaPayableTotalsSchema,
  })
  .strict();

export const mgaPayableListResponseSchema = z
  .object({
    groups: z.array(mgaPayableGroupSchema),
    status: z.enum(MGA_PAYABLE_FILTERS),
    summary: mgaPayableTotalsSchema,
  })
  .strict();

export type MgaPayableFilter = z.output<
  typeof mgaPayableListQuerySchema
>["status"];
export type MgaPayableItem = z.output<typeof mgaPayableItemSchema>;
export type MgaPayableTotals = z.output<typeof mgaPayableTotalsSchema>;
export type MgaPayableGroup = z.output<typeof mgaPayableGroupSchema>;
export type MgaPayableListResponse = z.output<
  typeof mgaPayableListResponseSchema
>;
