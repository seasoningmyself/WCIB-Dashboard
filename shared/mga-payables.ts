import { z } from "zod";
import { ACCOUNT_ASSIGNMENTS } from "./policy-fields.js";
import { MGA_PAYMENT_STATUSES } from "./mga-payments.js";

export const MGA_PAYABLE_FILTERS = ["unpaid", "all", "paid"] as const;
export const MAX_MGA_PAYMENT_REFERENCE_LENGTH = 200;

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
    amountPaid: moneySchema,
    approvedAt: apiTimestampSchema,
    brokerFee: moneySchema,
    commissionAmount: moneySchema,
    commissionRate: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/).nullable(),
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

export const mgaPayableParamsSchema = z
  .object({ policyId: z.string().uuid() })
  .strict();

export const mgaPayableGroupParamsSchema = z
  .object({ mgaId: z.string().uuid() })
  .strict();

export const mgaPayableStateRequestSchema = z
  .object({
    reference: z
      .string()
      .trim()
      .min(1)
      .max(MAX_MGA_PAYMENT_REFERENCE_LENGTH)
      .nullable()
      .optional(),
    status: z.enum(MGA_PAYMENT_STATUSES),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.status === "unpaid" && input.reference != null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Unpaid state cannot include a payment reference",
        path: ["reference"],
      });
    }
  })
  .transform((input) => ({
    reference: input.status === "paid" ? (input.reference ?? null) : null,
    status: input.status,
  }));

export const mgaPayablePlacementSchema = z
  .object({
    associationCount: z.number().int().min(0).max(2),
    paySheetIds: z.array(z.string().uuid()).max(2),
  })
  .strict()
  .refine(
    (placement) =>
      placement.associationCount === placement.paySheetIds.length &&
      new Set(placement.paySheetIds).size === placement.paySheetIds.length,
    { message: "Placement count and unique sheet IDs must match" },
  );

export const mgaPayableStateResponseSchema = z
  .object({
    item: mgaPayableItemSchema,
    placement: mgaPayablePlacementSchema,
  })
  .strict();

export const mgaPayableGroupStateRequestSchema = z
  .object({ status: z.enum(MGA_PAYMENT_STATUSES) })
  .strict();

export const mgaPayableGroupStateResultSchema = z
  .object({
    item: mgaPayableItemSchema,
    placement: mgaPayablePlacementSchema,
  })
  .strict();

export const mgaPayableGroupStateResponseSchema = z
  .object({
    changedCount: z.number().int().nonnegative().max(5_000),
    results: z.array(mgaPayableGroupStateResultSchema).max(5_000),
    status: z.enum(MGA_PAYMENT_STATUSES),
  })
  .strict()
  .refine((response) => response.changedCount === response.results.length, {
    message: "Changed count and projected results must match",
  });

export type MgaPayableFilter = z.output<
  typeof mgaPayableListQuerySchema
>["status"];
export type MgaPayableItem = z.output<typeof mgaPayableItemSchema>;
export type MgaPayableTotals = z.output<typeof mgaPayableTotalsSchema>;
export type MgaPayableGroup = z.output<typeof mgaPayableGroupSchema>;
export type MgaPayableListResponse = z.output<
  typeof mgaPayableListResponseSchema
>;
export type MgaPayableStateRequest = z.output<
  typeof mgaPayableStateRequestSchema
>;
export type MgaPayableStateResponse = z.output<
  typeof mgaPayableStateResponseSchema
>;
export type MgaPayableGroupStateRequest = z.output<
  typeof mgaPayableGroupStateRequestSchema
>;
export type MgaPayableGroupStateResponse = z.output<
  typeof mgaPayableGroupStateResponseSchema
>;
