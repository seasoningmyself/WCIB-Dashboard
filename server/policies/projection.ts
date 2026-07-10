import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { PolicyRecord } from "../db/schema.js";

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
