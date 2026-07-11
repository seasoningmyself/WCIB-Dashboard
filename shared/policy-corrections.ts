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
