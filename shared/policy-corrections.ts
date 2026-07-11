import { z } from "zod";
import {
  ACCOUNT_ASSIGNMENTS,
  IPFS_CUSTOMER_TYPES,
  IPFS_FINANCING_CHOICES,
  PAYMENT_MODES,
} from "./policy-fields.js";
import { adminLedgerPolicySchema } from "./policy-ledger.js";
import { approveWithOverrideRequestSchema } from "./policy-overrides.js";

export const POLICY_CORRECTION_FIELDS = [
  "insuredName",
  "companyName",
  "policyNumber",
  "policyTypeId",
  "transactionType",
  "transactionNotes",
  "invoiceNumber",
  "effectiveDate",
  "expirationDate",
  "carrierId",
  "mgaId",
  "officeLocationId",
  "accountAssignment",
  "producerUserId",
  "kayleeSplit",
  "notes",
  "basePremium",
  "taxes",
  "mgaFee",
  "commissionRate",
  "commissionConfirmed",
  "amountPaid",
  "paymentMode",
  "depositOption",
  "financeReference",
  "ipfsFinanced",
  "ipfsManual",
  "ipfsReturning",
  "financeContact",
  "financeMeta",
] as const;

export type PolicyCorrectionField =
  (typeof POLICY_CORRECTION_FIELDS)[number];

export const MAX_POLICY_CORRECTION_BYTES = 16_384;
export const MAX_POLICY_CORRECTION_REASON_LENGTH = 500;

const moneySchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/);
const rateSchema = z
  .string()
  .regex(/^(100\.0000|([0-9]|[1-9][0-9])\.[0-9]{4})$/)
  .nullable();
const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isCalendarDate, "Invalid calendar date");
const nullableTextSchema = (maximum: number) =>
  z.string().trim().min(1).max(maximum).nullable();
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

const policyCorrectionValuesSchema = z
  .object({
    accountAssignment: z.enum(ACCOUNT_ASSIGNMENTS).optional(),
    amountPaid: moneySchema.optional(),
    basePremium: moneySchema.optional(),
    carrierId: z.string().uuid().optional(),
    commissionConfirmed: z.boolean().optional(),
    commissionRate: rateSchema.optional(),
    companyName: nullableTextSchema(300).optional(),
    depositOption: moneySchema.optional(),
    effectiveDate: calendarDateSchema.optional(),
    expirationDate: calendarDateSchema.optional(),
    financeContact: financeContactSchema.nullable().optional(),
    financeMeta: financeMetaSchema.nullable().optional(),
    financeReference: nullableTextSchema(300).optional(),
    insuredName: z.string().trim().min(1).max(300).optional(),
    invoiceNumber: nullableTextSchema(200).optional(),
    ipfsFinanced: z.enum(IPFS_FINANCING_CHOICES).nullable().optional(),
    ipfsManual: z.boolean().optional(),
    ipfsReturning: z.enum(IPFS_CUSTOMER_TYPES).nullable().optional(),
    kayleeSplit: z.enum(ACCOUNT_ASSIGNMENTS).optional(),
    mgaFee: moneySchema.optional(),
    mgaId: z.string().uuid().optional(),
    notes: nullableTextSchema(4_000).optional(),
    officeLocationId: z.string().uuid().optional(),
    paymentMode: z.enum(PAYMENT_MODES).optional(),
    policyNumber: z.string().trim().min(1).max(200).optional(),
    policyTypeId: z.string().uuid().optional(),
    producerUserId: z.string().uuid().nullable().optional(),
    taxes: moneySchema.optional(),
    transactionNotes: nullableTextSchema(2_000).optional(),
    transactionType: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const policyGeneralCorrectionSchema = z
  .object({
    changedFields: z
      .array(z.enum(POLICY_CORRECTION_FIELDS))
      .min(1)
      .max(POLICY_CORRECTION_FIELDS.length),
    reason: z
      .string()
      .trim()
      .min(1)
      .max(MAX_POLICY_CORRECTION_REASON_LENGTH),
    replacementValues: policyCorrectionValuesSchema,
  })
  .strict()
  .superRefine(validateExactCorrectionFields);

const expectedVersionSchema = z.string().datetime();

export const policyLedgerCorrectionRequestSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        change: policyGeneralCorrectionSchema,
        expectedUpdatedAt: expectedVersionSchema,
        kind: z.literal("general"),
      })
      .strict(),
    z
      .object({
        change: approveWithOverrideRequestSchema,
        expectedUpdatedAt: expectedVersionSchema,
        kind: z.literal("override"),
      })
      .strict(),
  ],
);

export const policyLedgerCorrectionResponseSchema = z
  .object({ policy: adminLedgerPolicySchema })
  .strict();

export type PolicyLedgerCorrectionRequest = z.output<
  typeof policyLedgerCorrectionRequestSchema
>;

function validateExactCorrectionFields(
  input: {
    changedFields: readonly PolicyCorrectionField[];
    replacementValues: Readonly<Record<string, unknown>>;
  },
  context: z.RefinementCtx,
): void {
  const changedFields = new Set(input.changedFields);
  const replacementFields = Object.keys(input.replacementValues);
  if (
    changedFields.size !== input.changedFields.length ||
    changedFields.size !== replacementFields.length ||
    replacementFields.some(
      (field) => !changedFields.has(field as PolicyCorrectionField),
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Changed fields must exactly match replacement values",
      path: ["changedFields"],
    });
  }
  if (
    Buffer.byteLength(JSON.stringify(input.replacementValues), "utf8") >
    MAX_POLICY_CORRECTION_BYTES
  ) {
    context.addIssue({
      code: "custom",
      message: "Correction values exceed the byte limit",
      path: ["replacementValues"],
    });
  }
}

function isCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}
