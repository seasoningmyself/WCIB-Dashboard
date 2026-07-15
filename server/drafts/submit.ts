import { and, eq } from "drizzle-orm";
import {
  calculateAgencyCommissionAmount,
  calculateDraftProposalTotal,
  compareMoney,
} from "../../shared/draft-calculations.js";
import type { ApiErrorDetail } from "../../shared/api-errors.js";
import type { CreateDraftRequest } from "../../shared/drafts.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { inActiveBusinessGeneration } from "../db/business-state.js";
import { drafts, type DraftRecord } from "../db/schema.js";
import {
  submitAdminPolicyDirectInTransaction,
  submitDraftForApproval,
  type PolicyLifecycleInput,
} from "../policies/lifecycle.js";
import { requireDraftSelfServiceActor } from "./access.js";
import {
  validateActiveDraftReferences,
  validateDraftProducerAssignment,
} from "./create.js";
import { draftRecordToInput } from "./record.js";

export type DraftSubmissionDestination = "approval" | "ledger";

export interface DraftSubmissionResult {
  destination: DraftSubmissionDestination;
  draft: DraftRecord;
}

export interface DraftSubmissionSnapshot {
  accountAssignment: NonNullable<CreateDraftRequest["accountAssignment"]>;
  amountPaid: string;
  basePremium: string;
  brokerFee: string;
  carrierId: string;
  commissionAmount: string;
  commissionConfirmed: boolean;
  commissionMode: NonNullable<CreateDraftRequest["commissionMode"]>;
  commissionRate: string | null;
  companyName: string | null;
  depositOption: string;
  effectiveDate: string;
  expirationDate: string;
  financeBalance: string;
  financeContact: DraftRecord["financeContact"];
  financeMeta: DraftRecord["financeMeta"];
  financeReference: string | null;
  insuredName: string;
  invoiceNumber: string | null;
  ipfsFinanced: CreateDraftRequest["ipfsFinanced"];
  ipfsManual: boolean;
  ipfsReturning: CreateDraftRequest["ipfsReturning"];
  kayleeSplit: NonNullable<CreateDraftRequest["accountAssignment"]>;
  mgaFee: string;
  mgaId: string;
  netDue: string;
  notes: string | null;
  officeLocationId: string;
  paymentMode: NonNullable<CreateDraftRequest["paymentMode"]>;
  policyNumber: string;
  policyTypeId: string;
  producerUserId: string | null;
  proposalTotal: string;
  schemaVersion: number;
  taxes: string;
  transactionNotes: string | null;
  transactionType: string;
}

export class DraftSubmissionNotFoundError extends Error {
  constructor() {
    super("Draft was not found");
    this.name = "DraftSubmissionNotFoundError";
  }
}

export class DraftNotSubmittableError extends Error {
  constructor() {
    super("Draft is not submittable");
    this.name = "DraftNotSubmittableError";
  }
}

export class DraftSubmissionValidationError extends Error {
  constructor(readonly details: ApiErrorDetail[]) {
    super("Draft is incomplete");
    this.name = "DraftSubmissionValidationError";
  }
}

export async function submitOwnDraft(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  draftId: string,
  submittedAt = new Date(),
): Promise<DraftSubmissionResult> {
  const ownerUserId = requireDraftSelfServiceActor(context);
  if (Number.isNaN(submittedAt.getTime())) {
    throw new DraftNotSubmittableError();
  }

  return database.transaction(async (transaction) => {
    const [record] = await transaction
      .select()
      .from(drafts)
      .where(
        and(
          eq(drafts.id, draftId),
          eq(drafts.ownerUserId, ownerUserId),
          inActiveBusinessGeneration(drafts.businessGenerationId),
        ),
      )
      .limit(1)
      .for("update");
    if (record === undefined) {
      throw new DraftSubmissionNotFoundError();
    }
    if (record.status !== "draft" || submittedAt < record.lastEditedAt) {
      throw new DraftNotSubmittableError();
    }

    const input = draftRecordToInput(record);
    validateDraftProducerAssignment(context, input);
    await validateActiveDraftReferences(transaction, input);
    const snapshot = buildDraftSubmissionSnapshot(record, input);
    const isAdmin = context.principal.capabilities.includes("admin");

    if (isAdmin) {
      await submitAdminPolicyDirectInTransaction(
        transaction,
        context,
        buildPolicyInput(snapshot),
        record.id,
        submittedAt,
      );
    } else {
      await submitDraftForApproval(
        transaction,
        context,
        record.id,
        snapshot,
        submittedAt,
      );
    }

    const [updated] = await transaction
      .select()
      .from(drafts)
      .where(
        and(
          eq(drafts.id, record.id),
          inActiveBusinessGeneration(drafts.businessGenerationId),
        ),
      )
      .limit(1);
    if (updated === undefined) {
      throw new DraftNotSubmittableError();
    }
    return {
      destination: isAdmin ? "ledger" : "approval",
      draft: updated,
    };
  });
}

export function buildDraftSubmissionSnapshot(
  record: DraftRecord,
  input = draftRecordToInput(record),
): DraftSubmissionSnapshot {
  const details = validateSubmissionFields(record, input);
  if (details.length > 0) {
    throw new DraftSubmissionValidationError(details);
  }

  const commissionAmount = calculateAgencyCommissionAmount({
    basePremium: input.basePremium,
    commissionMode: input.commissionMode,
    commissionRate: input.commissionRate,
  });
  return {
    accountAssignment: input.accountAssignment!,
    amountPaid: input.amountPaid!,
    basePremium: input.basePremium ?? "0.00",
    brokerFee: input.brokerFee!,
    carrierId: input.carrierId!,
    commissionAmount: commissionAmount!,
    commissionConfirmed: input.commissionConfirmed ?? false,
    commissionMode: input.commissionMode!,
    commissionRate: input.commissionRate ?? null,
    companyName: input.companyName ?? null,
    depositOption: input.depositOption ?? "0.00",
    effectiveDate: input.effectiveDate!,
    expirationDate: input.expirationDate!,
    financeBalance: record.financeBalance!,
    financeContact: record.financeContact,
    financeMeta: record.financeMeta,
    financeReference: input.financeReference ?? null,
    insuredName: input.insuredName!,
    invoiceNumber: input.invoiceNumber ?? null,
    ipfsFinanced: input.ipfsFinanced ?? null,
    ipfsManual: input.ipfsManual ?? false,
    ipfsReturning: input.ipfsReturning ?? null,
    kayleeSplit: input.accountAssignment!,
    mgaFee: input.mgaFee ?? "0.00",
    mgaId: input.mgaId!,
    netDue: record.netDue!,
    notes: input.notes ?? null,
    officeLocationId: input.officeLocationId!,
    paymentMode: input.paymentMode!,
    policyNumber: input.policyNumber!,
    policyTypeId: input.policyTypeId!,
    producerUserId: input.producerUserId ?? null,
    proposalTotal: input.proposalTotal!,
    schemaVersion: record.schemaVersion,
    taxes: input.taxes ?? "0.00",
    transactionNotes: input.transactionNotes ?? null,
    transactionType: input.transactionType!,
  };
}

function buildPolicyInput(
  snapshot: DraftSubmissionSnapshot,
): PolicyLifecycleInput {
  return { ...snapshot };
}

function validateSubmissionFields(
  record: DraftRecord,
  input: CreateDraftRequest,
): ApiErrorDetail[] {
  const details: ApiErrorDetail[] = [];
  const requireValue = (field: string, value: unknown, message: string) => {
    if (value === null || value === undefined || value === "") {
      details.push({ field, message });
    }
  };

  requireValue("insuredName", input.insuredName, "Insured name is required");
  requireValue("policyNumber", input.policyNumber, "Policy number is required");
  requireValue("policyTypeId", input.policyTypeId, "Policy type is required");
  requireValue(
    "transactionType",
    input.transactionType,
    "Transaction type is required",
  );
  if (
    input.transactionType != null &&
    ["audit", "endorsement"].includes(input.transactionType.toLowerCase())
  ) {
    requireValue(
      "invoiceNumber",
      input.invoiceNumber,
      "Invoice number is required for an audit or endorsement",
    );
  }
  requireValue("effectiveDate", input.effectiveDate, "Effective date is required");
  requireValue(
    "expirationDate",
    input.expirationDate,
    "Expiration date is required",
  );
  if (
    input.effectiveDate != null &&
    input.expirationDate != null &&
    input.expirationDate < input.effectiveDate
  ) {
    details.push({
      field: "expirationDate",
      message: "Expiration date cannot precede the effective date",
    });
  }
  requireValue("carrierId", input.carrierId, "Insurance company is required");
  requireValue("mgaId", input.mgaId, "MGA is required");
  requireValue(
    "officeLocationId",
    input.officeLocationId,
    "Office location is required",
  );
  requireValue(
    "accountAssignment",
    input.accountAssignment,
    "Account assignment is required",
  );
  requireValue("brokerFee", input.brokerFee, "Broker fee is required");
  requireValue(
    "commissionMode",
    input.commissionMode,
    "Commission mode is required",
  );

  const basePremium = input.basePremium ?? "0.00";
  if (input.commissionMode === "pct") {
    requireValue(
      "commissionRate",
      input.commissionRate,
      "Commission rate is required",
    );
    if (
      compareMoney(basePremium, "0.00") === 1 &&
      input.commissionConfirmed !== true
    ) {
      details.push({
        field: "commissionConfirmed",
        message: "Commission amount must be confirmed against the invoice",
      });
    }
  }
  if (
    calculateAgencyCommissionAmount({
      basePremium: input.basePremium,
      commissionMode: input.commissionMode,
      commissionRate: input.commissionRate,
    }) === null
  ) {
    details.push({
      field: "commissionRate",
      message: "Commission inputs are incomplete",
    });
  }

  requireValue(
    "amountPaid",
    input.amountPaid,
    "Amount collected from ePayPolicy is required",
  );
  if (input.amountPaid != null && compareMoney(input.amountPaid, "0.00") !== 1) {
    details.push({
      field: "amountPaid",
      message: "Amount collected must be greater than zero",
    });
  }
  requireValue(
    "proposalTotal",
    input.proposalTotal,
    "Proposal total cross-check is required",
  );
  const expectedProposalTotal = calculateDraftProposalTotal({
    basePremium: input.basePremium,
    brokerFee: input.brokerFee,
    mgaFee: input.mgaFee,
    taxes: input.taxes,
  });
  if (
    input.proposalTotal != null &&
    (compareMoney(input.proposalTotal, "0.00") !== 1 ||
      expectedProposalTotal === null ||
      compareMoney(input.proposalTotal, expectedProposalTotal) !== 0)
  ) {
    details.push({
      field: "proposalTotal",
      message: "Proposal total must match premium, taxes, MGA fee, and broker fee",
    });
  }
  if (record.netDue === null || compareMoney(record.netDue, "0.00") === -1) {
    details.push({
      field: "amountPaid",
      message: "Net due to MGA cannot be negative",
    });
  }

  requireValue("paymentMode", input.paymentMode, "Payment mode is required");
  if (record.financeBalance === null) {
    details.push({
      field: "amountPaid",
      message: "Financing balance inputs are incomplete",
    });
  }
  if (input.paymentMode === "deposit") {
    requireValue(
      "ipfsFinanced",
      input.ipfsFinanced,
      "Select whether the balance is financed with IPFS",
    );
    if (input.ipfsFinanced === "yes") {
      if (record.financeMeta === null) {
        details.push({
          field: "ipfsFinanced",
          message: "IPFS financing metadata is required",
        });
      }
      if (input.ipfsManual !== true) {
        requireValue(
          "ipfsReturning",
          input.ipfsReturning,
          "Choose whether the IPFS insured is new or returning",
        );
        requireValue(
          "financeContact.mobile",
          input.financeContact?.mobile,
          "IPFS mobile number is required",
        );
        requireValue(
          "financeContact.email",
          input.financeContact?.email,
          "IPFS email address is required",
        );
        requireValue(
          "financeContact.address",
          input.financeContact?.address,
          "IPFS mailing address is required",
        );
      }
    }
  }

  return details;
}
