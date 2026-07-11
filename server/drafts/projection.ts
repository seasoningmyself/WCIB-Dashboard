import type { AccessPrincipal } from "../auth/access.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { DraftRecord } from "../db/schema.js";

export const EMPLOYEE_DRAFT_FINANCIAL_VISIBILITY =
  "own_editing_draft_only" as const;

export const DRAFT_NONFINANCIAL_FIELDS = [
  "id",
  "ownerUserId",
  "schemaVersion",
  "status",
  "createdAt",
  "lastEditedAt",
  "submittedAt",
  "flagReason",
  "sentBackReason",
  "sentBackByUserId",
  "sentBackAt",
  "linkedQueueEntryId",
  "linkedPolicyId",
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
  "notes",
  "history",
] as const satisfies readonly (keyof DraftRecord)[];

export const DRAFT_FINANCIAL_FIELDS = [
  "basePremium",
  "taxes",
  "mgaFee",
  "brokerFee",
  "commissionMode",
  "commissionRate",
  "commissionConfirmed",
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
] as const satisfies readonly (keyof DraftRecord)[];

const DRAFT_ALL_FIELDS = [
  ...DRAFT_NONFINANCIAL_FIELDS,
  ...DRAFT_FINANCIAL_FIELDS,
] as const;

export type DraftNonfinancialProjection = Pick<
  DraftRecord,
  (typeof DRAFT_NONFINANCIAL_FIELDS)[number]
>;

export type DraftFullProjection = Pick<
  DraftRecord,
  (typeof DRAFT_ALL_FIELDS)[number]
>;

export type DraftProjection =
  | DraftNonfinancialProjection
  | DraftFullProjection
  | null;

export function canAccessDraft(
  principal: AccessPrincipal,
  ownerUserId: string,
): boolean {
  if (!principal.userActive) {
    return false;
  }
  if (principal.capabilities.includes("admin")) {
    return true;
  }
  return (
    (principal.staffRole === "employee" || principal.staffRole === "producer") &&
    principal.userId === ownerUserId
  );
}

export function projectDraftForAuthorizedContext(
  source: Readonly<DraftRecord>,
  context: AuthorizedRequestContext,
): DraftProjection {
  const { principal } = context;
  if (!canAccessDraft(principal, source.ownerUserId)) {
    return null;
  }

  return canSeeDraftFinancialFields(principal, source)
    ? pickFields(source, DRAFT_ALL_FIELDS)
    : pickFields(source, DRAFT_NONFINANCIAL_FIELDS);
}

function canSeeDraftFinancialFields(
  principal: AccessPrincipal,
  source: Readonly<DraftRecord>,
): boolean {
  if (principal.capabilities.includes("admin")) {
    return true;
  }

  // This is the single adjustment point for the pending client confirmation.
  return (
    EMPLOYEE_DRAFT_FINANCIAL_VISIBILITY === "own_editing_draft_only" &&
    principal.userId === source.ownerUserId &&
    source.status === "draft" &&
    (principal.staffRole === "employee" || principal.staffRole === "producer")
  );
}

function pickFields<
  TSource extends object,
  const TKeys extends readonly (keyof TSource)[],
>(source: Readonly<TSource>, fields: TKeys): Pick<TSource, TKeys[number]> {
  return Object.fromEntries(fields.map((field) => [field, source[field]])) as Pick<
    TSource,
    TKeys[number]
  >;
}
