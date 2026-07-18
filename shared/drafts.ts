import { z } from "zod";
import {
  ACCOUNT_ASSIGNMENTS,
  COMMISSION_MODES,
  DRAFT_STATUSES,
  IPFS_CUSTOMER_TYPES,
  IPFS_FINANCING_CHOICES,
  PAYMENT_MODES,
} from "./policy-fields.js";

const nullableUuidSchema = z.string().uuid().nullable().optional();
const nullableDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate, "Invalid calendar date")
  .nullable()
  .optional();
const nullableMoneySchema = fixedDecimalSchema(12, 2).nullable().optional();
const nullableRateSchema = fixedDecimalSchema(3, 4)
  .refine((value) => Number(value) <= 100, "Must be at most 100")
  .nullable()
  .optional();

const financeContactSchema = z
  .object({
    address: z.string().trim().max(500),
    email: z.string().trim().max(320),
    mobile: z.string().trim().max(50),
  })
  .strict();

const financeMetaSchema = z
  .object({
    billingType: z.literal("invoice"),
    loanType: z.literal("commercial"),
    minEarnedAmt: z.null(),
    minEarnedPct: z.null(),
  })
  .strict();

const draftWritableFields = {
  accountAssignment: z.enum(ACCOUNT_ASSIGNMENTS).nullable().optional(),
  amountPaid: nullableMoneySchema,
  basePremium: nullableMoneySchema,
  brokerFee: nullableMoneySchema,
  carrierId: nullableUuidSchema,
  commissionConfirmed: z.boolean().optional(),
  commissionMode: z.enum(COMMISSION_MODES).nullable().optional(),
  commissionRate: nullableRateSchema,
  companyName: nullableTextSchema(300),
  depositOption: nullableMoneySchema,
  effectiveDate: nullableDateSchema,
  expirationDate: nullableDateSchema,
  financeContact: financeContactSchema.nullable().optional(),
  financeReference: nullableTextSchema(300),
  insuredName: nullableTextSchema(300),
  invoiceNumber: nullableTextSchema(200),
  ipfsFinanced: z.enum(IPFS_FINANCING_CHOICES).nullable().optional(),
  ipfsManual: z.boolean().optional(),
  ipfsReturning: z.enum(IPFS_CUSTOMER_TYPES).nullable().optional(),
  mgaFee: nullableMoneySchema,
  mgaId: nullableUuidSchema,
  notes: nullableTextSchema(4_000),
  officeLocationId: nullableUuidSchema,
  paymentMode: z.enum(PAYMENT_MODES).nullable().optional(),
  policyNumber: nullableTextSchema(200),
  policyTypeId: nullableUuidSchema,
  producerUserId: nullableUuidSchema,
  proposalTotal: nullableMoneySchema,
  taxes: nullableMoneySchema,
  transactionNotes: nullableTextSchema(2_000),
  transactionType: nullableTextSchema(100),
} as const;

export const createDraftRequestSchema = z
  .object(draftWritableFields)
  .strict()
  .superRefine(validateAssignmentPair);

export const updateDraftRequestSchema = z
  .object(draftWritableFields)
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one editable field is required",
  });

export function draftWritableInputFromSource(
  source: unknown,
): CreateDraftRequest {
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    return createDraftRequestSchema.parse(source);
  }
  const record = source as Record<string, unknown>;
  return createDraftRequestSchema.parse(
    Object.fromEntries(
      Object.keys(draftWritableFields)
        .filter((field) => field in record)
        .map((field) => [field, record[field]]),
    ),
  );
}

export const draftIdParamsSchema = z
  .object({ draftId: z.string().uuid() })
  .strict();

export const submitDraftRequestSchema = z.object({}).strict();

export const flagDraftRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const listDraftsQuerySchema = z
  .object({
    status: z.enum(DRAFT_STATUSES).optional(),
  })
  .strict();

const apiTimestampSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.string().datetime(),
);

const draftNonfinancialApiFields = {
  accountAssignment: z.enum(ACCOUNT_ASSIGNMENTS).nullable(),
  carrierId: z.string().uuid().nullable(),
  companyName: z.string().nullable(),
  createdAt: apiTimestampSchema,
  effectiveDate: z.string().nullable(),
  expirationDate: z.string().nullable(),
  flagReason: z.string().nullable(),
  history: z.array(z.unknown()),
  id: z.string().uuid(),
  insuredName: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  lastEditedAt: apiTimestampSchema,
  linkedPolicyId: z.string().uuid().nullable(),
  linkedQueueEntryId: z.string().uuid().nullable(),
  mgaId: z.string().uuid().nullable(),
  notes: z.string().nullable(),
  officeLocationId: z.string().uuid().nullable(),
  ownerUserId: z.string().uuid(),
  policyNumber: z.string().nullable(),
  policyTypeId: z.string().uuid().nullable(),
  producerUserId: z.string().uuid().nullable(),
  schemaVersion: z.number().int().positive(),
  sentBackAt: apiTimestampSchema.nullable(),
  sentBackByUserId: z.string().uuid().nullable(),
  sentBackReason: z.string().nullable(),
  status: z.enum(DRAFT_STATUSES),
  submittedAt: apiTimestampSchema.nullable(),
  transactionNotes: z.string().nullable(),
  transactionType: z.string().nullable(),
} as const;

const draftFinancialApiFields = {
  agencyCommissionAmount: z.string().nullable().optional(),
  amountPaid: z.string().nullable().optional(),
  basePremium: z.string().nullable().optional(),
  brokerFee: z.string().nullable().optional(),
  commissionConfirmed: z.boolean().optional(),
  commissionMode: z.enum(COMMISSION_MODES).nullable().optional(),
  commissionRate: z.string().nullable().optional(),
  depositOption: z.string().nullable().optional(),
  financeBalance: z.string().nullable().optional(),
  financeContact: financeContactSchema.nullable().optional(),
  financeMeta: financeMetaSchema.nullable().optional(),
  financeReference: z.string().nullable().optional(),
  ipfsFinanced: z.enum(IPFS_FINANCING_CHOICES).nullable().optional(),
  ipfsManual: z.boolean().optional(),
  ipfsPushed: z.boolean().optional(),
  ipfsPushedAt: apiTimestampSchema.nullable().optional(),
  ipfsReturning: z.enum(IPFS_CUSTOMER_TYPES).nullable().optional(),
  mgaFee: z.string().nullable().optional(),
  netDue: z.string().nullable().optional(),
  paymentMode: z.enum(PAYMENT_MODES).nullable().optional(),
  proposalTotal: z.string().nullable().optional(),
  taxes: z.string().nullable().optional(),
} as const;

export const draftResponseSchema = z
  .object({
    ...draftNonfinancialApiFields,
    ...draftFinancialApiFields,
  })
  .strict();

export const createDraftResponseSchema = z
  .object({ draft: draftResponseSchema })
  .strict();

export const editDraftResponseSchema = createDraftResponseSchema;

export const submitDraftResponseSchema = z
  .object({
    destination: z.enum(["approval", "ledger"]),
    draft: draftResponseSchema,
  })
  .strict();

export const flagDraftResponseSchema = createDraftResponseSchema;

export const withdrawFlaggedDraftRequestSchema = z.object({}).strict();

export const withdrawFlaggedDraftResponseSchema = createDraftResponseSchema;

export const withdrawSubmittedDraftRequestSchema = z.object({}).strict();

export const withdrawSubmittedDraftResponseSchema = createDraftResponseSchema;

export const listDraftsResponseSchema = z
  .object({ drafts: z.array(draftResponseSchema) })
  .strict();

export type CreateDraftRequest = z.output<typeof createDraftRequestSchema>;
export type DraftResponse = z.output<typeof draftResponseSchema>;
export type CreateDraftResponse = z.output<typeof createDraftResponseSchema>;
export type UpdateDraftRequest = z.output<typeof updateDraftRequestSchema>;
export type SubmitDraftResponse = z.output<typeof submitDraftResponseSchema>;
export type FlagDraftRequest = z.output<typeof flagDraftRequestSchema>;
export type WithdrawFlaggedDraftResponse = z.output<
  typeof withdrawFlaggedDraftResponseSchema
>;
export type WithdrawSubmittedDraftResponse = z.output<
  typeof withdrawSubmittedDraftResponseSchema
>;
export type ListDraftsQuery = z.output<typeof listDraftsQuerySchema>;
export type ListDraftsResponse = z.output<typeof listDraftsResponseSchema>;

function fixedDecimalSchema(integerDigits: number, scale: number) {
  const pattern = new RegExp(
    `^(?:0|[1-9]\\d{0,${integerDigits - 1}})(?:\\.\\d{1,${scale}})?$`,
  );
  return z
    .string()
    .trim()
    .regex(pattern, `Expected a non-negative decimal with at most ${scale} places`)
    .transform((value) => normalizeFixedDecimal(value, scale));
}

function normalizeFixedDecimal(value: string, scale: number): string {
  const [integer = "0", fraction = ""] = value.split(".");
  return `${integer}.${fraction.padEnd(scale, "0")}`;
}

function nullableTextSchema(maxLength: number) {
  return z
    .string()
    .trim()
    .max(maxLength)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();
}

function isCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function validateAssignmentPair(
  input: {
    accountAssignment?: "none" | "book" | "house" | null;
    producerUserId?: string | null;
  },
  context: z.RefinementCtx,
): void {
  const assignment = input.accountAssignment;
  const producerUserId = input.producerUserId;
  if (assignment === undefined && producerUserId === undefined) {
    return;
  }

  if (assignment === "book" || assignment === "house") {
    if (producerUserId === null || producerUserId === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Producer assignment requires a producer",
        path: ["producerUserId"],
      });
    }
    return;
  }

  if (producerUserId !== null && producerUserId !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "House account cannot select a producer",
      path: ["producerUserId"],
    });
  }
}
