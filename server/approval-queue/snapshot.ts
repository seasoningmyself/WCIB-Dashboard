import { z } from "zod";
import {
  ACCOUNT_ASSIGNMENTS,
  COMMISSION_MODES,
  IPFS_CUSTOMER_TYPES,
  IPFS_FINANCING_CHOICES,
  PAYMENT_MODES,
} from "../../shared/policy-fields.js";
import type { DraftSubmissionSnapshot } from "../drafts/submit.js";

const moneySchema = z.string().regex(/^\d{1,12}\.\d{2}$/);
const rateSchema = z.string().regex(/^\d{1,3}\.\d{4}$/).nullable();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nullableTextSchema = z.string().nullable();
const financeContactSchema = z
  .object({
    address: z.string().max(500),
    email: z.string().max(320),
    mobile: z.string().max(50),
  })
  .strict()
  .nullable();
const financeMetaSchema = z
  .object({
    billingType: z.literal("invoice"),
    loanType: z.literal("commercial"),
    minEarnedAmt: z.null(),
    minEarnedPct: z.null(),
  })
  .strict()
  .nullable();

export const draftSubmissionSnapshotSchema = z
  .object({
    accountAssignment: z.enum(ACCOUNT_ASSIGNMENTS),
    amountPaid: moneySchema,
    basePremium: moneySchema,
    brokerFee: moneySchema,
    carrierId: z.string().uuid(),
    commissionAmount: moneySchema,
    commissionConfirmed: z.boolean(),
    commissionMode: z.enum(COMMISSION_MODES),
    commissionRate: rateSchema,
    companyName: nullableTextSchema,
    depositOption: moneySchema,
    effectiveDate: dateSchema,
    expirationDate: dateSchema,
    financeBalance: moneySchema,
    financeContact: financeContactSchema,
    financeMeta: financeMetaSchema,
    financeReference: nullableTextSchema,
    insuredName: z.string().min(1),
    invoiceNumber: nullableTextSchema,
    ipfsFinanced: z.enum(IPFS_FINANCING_CHOICES).nullable(),
    ipfsManual: z.boolean(),
    ipfsReturning: z.enum(IPFS_CUSTOMER_TYPES).nullable(),
    kayleeSplit: z.enum(ACCOUNT_ASSIGNMENTS),
    mgaFee: moneySchema,
    mgaId: z.string().uuid(),
    netDue: moneySchema,
    notes: nullableTextSchema,
    officeLocationId: z.string().uuid(),
    paymentMode: z.enum(PAYMENT_MODES),
    policyNumber: z.string().min(1),
    policyTypeId: z.string().uuid(),
    producerUserId: z.string().uuid().nullable(),
    proposalTotal: moneySchema,
    schemaVersion: z.number().int().positive(),
    taxes: moneySchema,
    transactionNotes: nullableTextSchema,
    transactionType: z.string().min(1),
  })
  .strict();

export function parseDraftSubmissionSnapshot(
  source: unknown,
): DraftSubmissionSnapshot {
  return draftSubmissionSnapshotSchema.parse(source) as DraftSubmissionSnapshot;
}
