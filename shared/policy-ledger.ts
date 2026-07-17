import { z } from "zod";
import {
  ACCOUNT_ASSIGNMENTS,
  COMMISSION_MODES,
  IPFS_CUSTOMER_TYPES,
  IPFS_FINANCING_CHOICES,
  PAYABLE_STATUSES,
  PAYMENT_MODES,
  RECEIVABLE_STATUSES,
} from "./policy-fields.js";
import { POLICY_TYPE_CLASSES } from "./policy-types.js";

export const POLICY_LEDGER_SORTS = [
  "date",
  "insured",
  "mga",
  "transaction",
  "submitter",
  "account",
] as const;

export const POLICY_LEDGER_FINANCE_FILTERS = [
  "all",
  "financed",
  "ipfs_pending",
  "ipfs_completed",
] as const;

export const POLICY_LEDGER_DUPLICATE_FILTERS = ["all", "only"] as const;
export const POLICY_LEDGER_MAX_LIMIT = 200;

const queryInteger = (minimum: number, maximum: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : value,
    z.number().int().min(minimum).max(maximum),
  );

export const policyLedgerListQuerySchema = z
  .object({
    direction: z.enum(["asc", "desc"]).optional(),
    duplicates: z.enum(POLICY_LEDGER_DUPLICATE_FILTERS).default("all"),
    finance: z.enum(POLICY_LEDGER_FINANCE_FILTERS).default("all"),
    limit: queryInteger(1, POLICY_LEDGER_MAX_LIMIT).default(100),
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
    offset: queryInteger(0, 10_000).default(0),
    search: z.string().trim().max(200).default(""),
    sort: z.enum(POLICY_LEDGER_SORTS).default("insured"),
  })
  .strict();

export const policyLedgerParamsSchema = z
  .object({ policyId: z.string().uuid() })
  .strict();

const apiTimestampSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.string().datetime(),
);

const moneySchema = z.string().regex(/^(0|[1-9][0-9]*)\.[0-9]{2}$/);
const decimalSchema = z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/);
const jsonObjectSchema = z.record(z.string(), z.unknown());

export const adminLedgerPolicySchema = z
  .object({
    accountAssignment: z.enum(ACCOUNT_ASSIGNMENTS),
    amountPaid: moneySchema,
    approvedAt: apiTimestampSchema,
    balanceDueDate: z.string().nullable(),
    basePremium: moneySchema,
    brokerFee: moneySchema,
    carrierId: z.string().uuid(),
    collectedToDate: moneySchema,
    commissionAmount: moneySchema,
    commissionConfirmed: z.boolean(),
    commissionMode: z.enum(COMMISSION_MODES),
    commissionRate: decimalSchema.nullable(),
    companyName: z.string().nullable(),
    createdAt: apiTimestampSchema,
    depositOption: moneySchema,
    effectiveDate: z.string(),
    expirationDate: z.string(),
    financeBalance: moneySchema,
    financeContact: jsonObjectSchema.nullable(),
    financeMeta: jsonObjectSchema.nullable(),
    financeReference: z.string().nullable(),
    id: z.string().uuid(),
    insuredName: z.string(),
    invoiceNumber: z.string().nullable(),
    ipfsFinanced: z.enum(IPFS_FINANCING_CHOICES).nullable(),
    ipfsManual: z.boolean(),
    ipfsPushed: z.boolean(),
    ipfsPushedAt: apiTimestampSchema.nullable(),
    ipfsReturning: z.enum(IPFS_CUSTOMER_TYPES).nullable(),
    kayleeSplit: z.enum(ACCOUNT_ASSIGNMENTS),
    mgaFee: moneySchema,
    mgaId: z.string().uuid(),
    mgaPaid: z.boolean(),
    mgaPaidAt: apiTimestampSchema.nullable(),
    mgaPayReference: z.string().nullable(),
    netDue: moneySchema,
    netDueTotal: moneySchema,
    notes: z.string().nullable(),
    officeLocationId: z.string().uuid(),
    overridden: z.boolean(),
    payableStatus: z.enum(PAYABLE_STATUSES),
    paymentMode: z.enum(PAYMENT_MODES),
    policyNumber: z.string(),
    policyTypeId: z.string().uuid(),
    premiumTotal: moneySchema,
    producerUserId: z.string().uuid().nullable(),
    proposalTotal: moneySchema,
    receivableStatus: z.enum(RECEIVABLE_STATUSES),
    remittedToMga: moneySchema,
    sourceDraftId: z.string().uuid().nullable(),
    submittedAt: apiTimestampSchema,
    submittedByUserId: z.string().uuid(),
    taxes: moneySchema,
    transactionNotes: z.string().nullable(),
    transactionType: z.string(),
    updatedAt: apiTimestampSchema,
  })
  .strict();

export const policyLedgerLabelsSchema = z
  .object({
    carrierName: z.string(),
    mgaName: z.string(),
    officeName: z.string(),
    policyTypeClass: z.enum(POLICY_TYPE_CLASSES),
    policyTypeName: z.string(),
    producerDisplayName: z.string().nullable(),
    submitterDisplayName: z.string(),
  })
  .strict();

export const policyLedgerDuplicateSchema = z
  .object({
    count: z.number().int().min(2),
    kind: z.enum(["possible", "likely"]),
  })
  .strict()
  .nullable();

export const policyLedgerItemSchema = z
  .object({
    duplicate: policyLedgerDuplicateSchema,
    labels: policyLedgerLabelsSchema,
    policy: adminLedgerPolicySchema,
  })
  .strict();

export const policyLedgerTotalsSchema = z
  .object({
    agencyRevenue: moneySchema,
    amountPaid: moneySchema,
    brokerFee: moneySchema,
    commissionAmount: moneySchema,
    producerPayout: moneySchema,
    sophiaRetained: moneySchema,
  })
  .strict();

export const policyLedgerListResponseSchema = z
  .object({
    filteredTotal: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    items: z.array(policyLedgerItemSchema).max(POLICY_LEDGER_MAX_LIMIT),
    limit: z.number().int().min(1).max(POLICY_LEDGER_MAX_LIMIT),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    offset: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    totals: policyLedgerTotalsSchema,
  })
  .strict();

export const policyLedgerDetailResponseSchema = z
  .object({ item: policyLedgerItemSchema })
  .strict();

export type PolicyLedgerListQuery = z.output<
  typeof policyLedgerListQuerySchema
>;
export type PolicyLedgerPolicy = z.output<typeof adminLedgerPolicySchema>;
export type PolicyLedgerLabels = z.output<typeof policyLedgerLabelsSchema>;
export type PolicyLedgerDuplicate = z.output<
  typeof policyLedgerDuplicateSchema
>;
export type PolicyLedgerItem = z.output<typeof policyLedgerItemSchema>;
export type PolicyLedgerTotals = z.output<typeof policyLedgerTotalsSchema>;
export type PolicyLedgerListResponse = z.output<
  typeof policyLedgerListResponseSchema
>;
export type PolicyLedgerDetailResponse = z.output<
  typeof policyLedgerDetailResponseSchema
>;
