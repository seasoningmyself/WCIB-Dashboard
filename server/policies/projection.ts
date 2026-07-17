import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { PolicyRecord } from "../db/schema.js";
import {
  policyLedgerTotalsSchema,
  type PolicyLedgerTotals,
} from "../../shared/policy-ledger.js";

export const POLICY_FINANCIAL_FIELDS = [
  "accountAssignment",
  "producerUserId",
  "kayleeSplit",
  "basePremium",
  "taxes",
  "mgaFee",
  "brokerFee",
  "commissionAmount",
  "commissionMode",
  "commissionRate",
  "commissionConfirmed",
  "overridden",
  "amountPaid",
  "proposalTotal",
  "netDue",
  "paymentMode",
  "depositOption",
  "financeBalance",
  "financeReference",
  "ipfsFinanced",
  "ipfsManual",
  "ipfsReturning",
  "financeContact",
  "financeMeta",
  "ipfsPushed",
  "ipfsPushedAt",
  "mgaPaid",
  "mgaPayReference",
  "mgaPaidAt",
  "premiumTotal",
  "collectedToDate",
  "netDueTotal",
  "remittedToMga",
  "receivableStatus",
  "payableStatus",
  "balanceDueDate",
] as const satisfies readonly (keyof PolicyRecord)[];

const ADMIN_POLICY_FIELDS = [
  "id",
  "sourceDraftId",
  "submittedByUserId",
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
  ...POLICY_FINANCIAL_FIELDS,
  "notes",
  "submittedAt",
  "approvedAt",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof PolicyRecord)[];

export type AdminPolicyProjection = Pick<
  PolicyRecord,
  (typeof ADMIN_POLICY_FIELDS)[number]
>;

export interface AdminDeletedPolicyProjection {
  deletion: {
    deletedAt: Date;
    deletedByUserId: string;
    reason: string;
  };
  policy: AdminPolicyProjection;
}

export interface AdminPolicyFinancialSplitProjection {
  producerPayout: string;
  sophiaRetained: string;
}

export function projectAdminPolicy(
  source: Readonly<PolicyRecord>,
  context: AuthorizedRequestContext,
): AdminPolicyProjection | null {
  const { principal } = context;
  if (!principal.userActive || !principal.capabilities.includes("admin")) {
    return null;
  }

  return Object.fromEntries(
    ADMIN_POLICY_FIELDS.map((field) => [field, source[field]]),
  ) as AdminPolicyProjection;
}

export function projectAdminPolicyFinancialSplit(
  source: Readonly<AdminPolicyFinancialSplitProjection>,
  context: AuthorizedRequestContext,
): AdminPolicyFinancialSplitProjection | null {
  if (!canProjectAdmin(context)) {
    return null;
  }
  return {
    producerPayout: source.producerPayout,
    sophiaRetained: source.sophiaRetained,
  };
}

export function projectAdminPolicyLedgerTotals(
  source: Readonly<PolicyLedgerTotals>,
  context: AuthorizedRequestContext,
): PolicyLedgerTotals | null {
  return canProjectAdmin(context) ? policyLedgerTotalsSchema.parse(source) : null;
}

export function projectAdminDeletedPolicy(
  source: Readonly<PolicyRecord>,
  context: AuthorizedRequestContext,
): AdminDeletedPolicyProjection | null {
  const policy = projectAdminPolicy(source, context);
  if (policy === null) {
    return null;
  }
  if (
    source.deletedAt === null ||
    source.deletedByUserId === null ||
    source.deleteReason === null
  ) {
    throw new Error("Deleted policy projection requires deletion metadata");
  }
  return {
    deletion: {
      deletedAt: source.deletedAt,
      deletedByUserId: source.deletedByUserId,
      reason: source.deleteReason,
    },
    policy,
  };
}

function canProjectAdmin(context: AuthorizedRequestContext): boolean {
  const { principal } = context;
  return principal.userActive && principal.capabilities.includes("admin");
}
