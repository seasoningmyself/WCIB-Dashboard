import {
  createDraftRequestSchema,
  type CreateDraftRequest,
} from "../../shared/drafts.js";
import type { DraftRecord } from "../db/schema.js";

export function draftRecordToInput(record: DraftRecord): CreateDraftRequest {
  return createDraftRequestSchema.parse({
    accountAssignment: record.accountAssignment,
    amountPaid: record.amountPaid,
    basePremium: record.basePremium,
    brokerFee: record.brokerFee,
    carrierId: record.carrierId,
    commissionConfirmed: record.commissionConfirmed,
    commissionMode: record.commissionMode,
    commissionRate: record.commissionRate,
    companyName: record.companyName,
    depositOption: record.depositOption,
    effectiveDate: record.effectiveDate,
    expirationDate: record.expirationDate,
    financeContact: record.financeContact,
    financeReference: record.financeReference,
    insuredName: record.insuredName,
    invoiceNumber: record.invoiceNumber,
    ipfsFinanced: record.ipfsFinanced,
    ipfsManual: record.ipfsManual,
    ipfsReturning: record.ipfsReturning,
    mgaFee: record.mgaFee,
    mgaId: record.mgaId,
    notes: record.notes,
    officeLocationId: record.officeLocationId,
    paymentMode: record.paymentMode,
    policyNumber: record.policyNumber,
    policyTypeId: record.policyTypeId,
    producerUserId: record.producerUserId,
    proposalTotal: record.proposalTotal,
    taxes: record.taxes,
    transactionNotes: record.transactionNotes,
    transactionType: record.transactionType,
  });
}
