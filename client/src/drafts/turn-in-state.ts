import type { CurrentUser } from "../../../shared/current-user.js";
import type {
  DraftAssignmentOption,
} from "../../../shared/draft-assignment-options.js";
import {
  calculateAgencyCommissionAmount,
  calculateDraftFinanceBalance,
  calculateDraftNetDue,
  calculateDraftProposalTotal,
  compareMoney,
} from "../../../shared/draft-calculations.js";
import type {
  CreateDraftRequest,
  DraftResponse,
  UpdateDraftRequest,
} from "../../../shared/drafts.js";
import type {
  AccountAssignment,
  CommissionMode,
  IpfsCustomerType,
  IpfsFinancingChoice,
  PaymentMode,
} from "../../../shared/policy-fields.js";

export const TURN_IN_TRANSACTION_TYPES = [
  "New",
  "Renewal",
  "Rewrite",
  "Won Back",
  "Cross-sale",
  "Endorsement",
  "Audit",
] as const;

export interface TurnInFormState {
  accountAssignment: AccountAssignment | "";
  amountPaid: string;
  basePremium: string;
  brokerFee: string;
  carrierId: string | null;
  commissionConfirmed: boolean;
  commissionMode: CommissionMode;
  commissionRate: string;
  companyName: string;
  depositOption: string;
  effectiveDate: string;
  expirationDate: string;
  financeAddress: string;
  financeEmail: string;
  financeMobile: string;
  financeReference: string;
  insuredName: string;
  invoiceNumber: string;
  ipfsFinanced: IpfsFinancingChoice | "";
  ipfsManual: boolean;
  ipfsReturning: IpfsCustomerType | "";
  mgaFee: string;
  mgaId: string | null;
  notes: string;
  officeLocationId: string | null;
  paymentMode: PaymentMode;
  policyNumber: string;
  policyTypeId: string | null;
  producerUserId: string | null;
  proposalTotal: string;
  taxes: string;
  transactionNotes: string;
  transactionType: string;
}

export interface AssignmentChoice {
  accountAssignment: AccountAssignment;
  key: string;
  label: string;
  producerUserId: string | null;
}

export type TurnInValidationErrors = Readonly<Record<string, string>>;

export function createEmptyTurnInState(): TurnInFormState {
  return {
    accountAssignment: "",
    amountPaid: "",
    basePremium: "",
    brokerFee: "",
    carrierId: null,
    commissionConfirmed: false,
    commissionMode: "pct",
    commissionRate: "",
    companyName: "",
    depositOption: "",
    effectiveDate: "",
    expirationDate: "",
    financeAddress: "",
    financeEmail: "",
    financeMobile: "",
    financeReference: "",
    insuredName: "",
    invoiceNumber: "",
    ipfsFinanced: "",
    ipfsManual: false,
    ipfsReturning: "",
    mgaFee: "0.00",
    mgaId: null,
    notes: "",
    officeLocationId: null,
    paymentMode: "full",
    policyNumber: "",
    policyTypeId: null,
    producerUserId: null,
    proposalTotal: "",
    taxes: "0.00",
    transactionNotes: "",
    transactionType: "",
  };
}

export function updateTurnInField<Key extends keyof TurnInFormState>(
  state: TurnInFormState,
  field: Key,
  value: TurnInFormState[Key],
): TurnInFormState {
  const next = { ...state, [field]: value };
  if (
    field === "basePremium" ||
    field === "commissionMode" ||
    field === "commissionRate"
  ) {
    next.commissionConfirmed = false;
  }
  if (
    field === "paymentMode" &&
    value === "deposit" &&
    state.ipfsFinanced === ""
  ) {
    next.ipfsFinanced = "yes";
  }
  return next;
}

export function suggestAnnualExpiration(
  effectiveDate: string,
  policyTypeName: string,
): string | null {
  const annualPolicyType = [
    "general liability",
    "inland marine",
    "worker",
    "pollution",
    "errors",
  ].some((term) => policyTypeName.toLowerCase().includes(term));
  if (!annualPolicyType || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    return null;
  }
  const date = new Date(`${effectiveDate}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 2000) {
    return null;
  }
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

export function turnInFormToDraftInput(
  state: TurnInFormState,
): CreateDraftRequest {
  const usesIpfs =
    state.paymentMode === "deposit" && state.ipfsFinanced === "yes";
  return {
    accountAssignment: state.accountAssignment || null,
    amountPaid: moneyOrNull(state.amountPaid),
    basePremium: moneyOrNull(state.basePremium),
    brokerFee: moneyOrNull(state.brokerFee),
    carrierId: state.carrierId,
    commissionConfirmed:
      state.commissionMode === "pct" ? state.commissionConfirmed : false,
    commissionMode: state.commissionMode,
    commissionRate:
      state.commissionMode === "pct"
        ? rateOrNull(state.commissionRate)
        : null,
    companyName: textOrNull(state.companyName),
    depositOption: moneyOrNull(state.depositOption),
    effectiveDate: textOrNull(state.effectiveDate),
    expirationDate: textOrNull(state.expirationDate),
    financeContact: usesIpfs
      ? {
          address: state.financeAddress.trim(),
          email: state.financeEmail.trim(),
          mobile: state.financeMobile.trim(),
        }
      : null,
    financeReference:
      state.paymentMode === "deposit"
        ? textOrNull(state.financeReference)
        : null,
    insuredName: textOrNull(state.insuredName),
    invoiceNumber: textOrNull(state.invoiceNumber),
    ipfsFinanced:
      state.paymentMode === "deposit" ? state.ipfsFinanced || null : null,
    ipfsManual: usesIpfs ? state.ipfsManual : false,
    ipfsReturning: usesIpfs ? state.ipfsReturning || null : null,
    mgaFee: moneyOrNull(state.mgaFee),
    mgaId: state.mgaId,
    notes: textOrNull(state.notes),
    officeLocationId: state.officeLocationId,
    paymentMode: state.paymentMode,
    policyNumber: textOrNull(state.policyNumber),
    policyTypeId: state.policyTypeId,
    producerUserId: state.producerUserId,
    proposalTotal: moneyOrNull(state.proposalTotal),
    taxes: moneyOrNull(state.taxes),
    transactionNotes: textOrNull(state.transactionNotes),
    transactionType: textOrNull(state.transactionType),
  };
}

export function turnInFormToNonfinancialDraftUpdate(
  state: TurnInFormState,
): UpdateDraftRequest {
  return {
    accountAssignment: state.accountAssignment || null,
    carrierId: state.carrierId,
    companyName: textOrNull(state.companyName),
    effectiveDate: textOrNull(state.effectiveDate),
    expirationDate: textOrNull(state.expirationDate),
    insuredName: textOrNull(state.insuredName),
    invoiceNumber: textOrNull(state.invoiceNumber),
    mgaId: state.mgaId,
    notes: textOrNull(state.notes),
    officeLocationId: state.officeLocationId,
    policyNumber: textOrNull(state.policyNumber),
    policyTypeId: state.policyTypeId,
    producerUserId: state.producerUserId,
    transactionNotes: textOrNull(state.transactionNotes),
    transactionType: textOrNull(state.transactionType),
  };
}

export function turnInStateFromDraft(draft: DraftResponse): TurnInFormState {
  return {
    accountAssignment: draft.accountAssignment ?? "",
    amountPaid: draft.amountPaid ?? "",
    basePremium: draft.basePremium ?? "",
    brokerFee: draft.brokerFee ?? "",
    carrierId: draft.carrierId,
    commissionConfirmed: draft.commissionConfirmed ?? false,
    commissionMode: draft.commissionMode ?? "pct",
    commissionRate: draft.commissionRate ?? "",
    companyName: draft.companyName ?? "",
    depositOption: draft.depositOption ?? "",
    effectiveDate: draft.effectiveDate ?? "",
    expirationDate: draft.expirationDate ?? "",
    financeAddress: draft.financeContact?.address ?? "",
    financeEmail: draft.financeContact?.email ?? "",
    financeMobile: draft.financeContact?.mobile ?? "",
    financeReference: draft.financeReference ?? "",
    insuredName: draft.insuredName ?? "",
    invoiceNumber: draft.invoiceNumber ?? "",
    ipfsFinanced: draft.ipfsFinanced ?? "",
    ipfsManual: draft.ipfsManual ?? false,
    ipfsReturning: draft.ipfsReturning ?? "",
    mgaFee: draft.mgaFee ?? "0.00",
    mgaId: draft.mgaId,
    notes: draft.notes ?? "",
    officeLocationId: draft.officeLocationId,
    paymentMode: draft.paymentMode ?? "full",
    policyNumber: draft.policyNumber ?? "",
    policyTypeId: draft.policyTypeId,
    producerUserId: draft.producerUserId,
    proposalTotal: draft.proposalTotal ?? "",
    taxes: draft.taxes ?? "0.00",
    transactionNotes: draft.transactionNotes ?? "",
    transactionType: draft.transactionType ?? "",
  };
}

export function calculateTurnInSummary(state: TurnInFormState) {
  const input = turnInFormToDraftInput(state);
  const commissionAmount = calculateAgencyCommissionAmount({
    basePremium: input.basePremium,
    commissionMode: input.commissionMode,
    commissionRate: input.commissionRate,
  });
  return {
    commissionAmount,
    financeBalance: calculateDraftFinanceBalance({
      amountPaid: input.amountPaid,
      paymentMode: input.paymentMode,
      proposalTotal: input.proposalTotal,
    }),
    netDue: calculateDraftNetDue({
      agencyCommissionAmount: commissionAmount,
      amountPaid: input.amountPaid,
      brokerFee: input.brokerFee,
    }),
    proposalTotal: calculateDraftProposalTotal({
      basePremium: input.basePremium,
      brokerFee: input.brokerFee,
      mgaFee: input.mgaFee,
      taxes: input.taxes,
    }),
  };
}

export function validateTurnInForSubmit(
  state: TurnInFormState,
): TurnInValidationErrors {
  const input = turnInFormToDraftInput(state);
  const summary = calculateTurnInSummary(state);
  const errors: Record<string, string> = {};
  requireField(errors, "accountAssignment", input.accountAssignment, "Choose an account assignment.");
  requireField(errors, "insuredName", input.insuredName, "Enter the insured name.");
  requireField(errors, "policyTypeId", input.policyTypeId, "Choose a policy type.");
  requireField(errors, "transactionType", input.transactionType, "Choose a transaction type.");
  if (isInvoiceTransaction(input.transactionType) && input.invoiceNumber == null) {
    errors.invoiceNumber = "Enter the invoice number for this transaction.";
  }
  requireField(errors, "effectiveDate", input.effectiveDate, "Enter the effective date.");
  requireField(errors, "expirationDate", input.expirationDate, "Enter the expiration date.");
  if (
    input.effectiveDate != null &&
    input.expirationDate != null &&
    input.expirationDate < input.effectiveDate
  ) {
    errors.expirationDate = "Expiration cannot precede the effective date.";
  }
  requireField(errors, "carrierId", input.carrierId, "Choose an insurance company.");
  requireField(errors, "mgaId", input.mgaId, "Choose an MGA.");
  requireField(errors, "policyNumber", input.policyNumber, "Enter the policy number.");
  requireField(errors, "officeLocationId", input.officeLocationId, "Choose an office location.");
  if (input.brokerFee == null) {
    errors.brokerFee = "Enter the broker fee, including zero when none applies.";
  }
  if (input.commissionMode === "pct" && input.commissionRate == null) {
    errors.commissionRate = "Enter the commission rate or choose TBD / N/A.";
  }
  if (
    input.commissionMode === "pct" &&
    input.basePremium != null &&
    compareMoney(input.basePremium, "0.00") === 1 &&
    !input.commissionConfirmed
  ) {
    errors.commissionConfirmed = "Confirm the agency commission against the carrier invoice.";
  }
  if (input.amountPaid == null || compareMoney(input.amountPaid, "0.00") !== 1) {
    errors.amountPaid = "Enter an amount collected greater than zero.";
  }
  if (
    input.proposalTotal == null ||
    compareMoney(input.proposalTotal, "0.00") !== 1 ||
    summary.proposalTotal === null ||
    compareMoney(input.proposalTotal, summary.proposalTotal) !== 0
  ) {
    errors.proposalTotal = "Proposal total must match premium, taxes, MGA fee, and broker fee.";
  }
  if (summary.netDue === null || compareMoney(summary.netDue, "0.00") === -1) {
    errors.amountPaid = "Net due to the MGA cannot be negative.";
  }
  if (state.paymentMode === "deposit") {
    if (state.ipfsFinanced === "") {
      errors.ipfsFinanced = "Choose whether this balance is financed with IPFS.";
    }
    if (state.ipfsFinanced === "yes" && !state.ipfsManual) {
      requireField(errors, "ipfsReturning", state.ipfsReturning, "Choose new or returning IPFS insured.");
      requireField(errors, "financeMobile", state.financeMobile.trim(), "Enter the insured mobile number.");
      requireField(errors, "financeEmail", state.financeEmail.trim(), "Enter the insured email address.");
      requireField(errors, "financeAddress", state.financeAddress.trim(), "Enter the insured mailing address.");
    }
    if (summary.financeBalance === null) {
      errors.amountPaid = "Amount collected cannot exceed the proposal total for financing.";
    }
  }
  return errors;
}

export function buildAssignmentChoices(
  user: CurrentUser,
  producers: readonly DraftAssignmentOption[],
): AssignmentChoice[] {
  if (user.role === "producer") {
    const name = user.displayName ?? user.email;
    return [
      assignmentChoice("none", null, "House account"),
      assignmentChoice("book", user.id, `${name} account`),
      assignmentChoice("house", user.id, "First-year"),
    ];
  }
  if (user.role === "employee") {
    return [
      assignmentChoice("none", null, "House account"),
      ...producers.map(({ displayName, userId }) =>
        assignmentChoice("book", userId, `${displayName} account`),
      ),
    ];
  }
  return [
    assignmentChoice("none", null, "House account"),
    ...producers.flatMap(({ displayName, userId }) => [
      assignmentChoice("book", userId, `${displayName} account`),
      assignmentChoice("house", userId, `${displayName} First-year`),
    ]),
  ];
}

export function assignmentKey(
  accountAssignment: TurnInFormState["accountAssignment"],
  producerUserId: string | null,
): string {
  return accountAssignment === ""
    ? ""
    : `${accountAssignment}:${producerUserId ?? "house"}`;
}

export function isInvoiceTransaction(value: string | null | undefined) {
  return value != null && ["audit", "endorsement"].includes(value.toLowerCase());
}

function assignmentChoice(
  accountAssignment: AccountAssignment,
  producerUserId: string | null,
  label: string,
): AssignmentChoice {
  return {
    accountAssignment,
    key: assignmentKey(accountAssignment, producerUserId),
    label,
    producerUserId,
  };
}

function requireField(
  errors: Record<string, string>,
  field: string,
  value: unknown,
  message: string,
) {
  if (value === null || value === undefined || value === "") {
    errors[field] = message;
  }
}

function textOrNull(value: string): string | null {
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function moneyOrNull(value: string): string | null {
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function rateOrNull(value: string): string | null {
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}
