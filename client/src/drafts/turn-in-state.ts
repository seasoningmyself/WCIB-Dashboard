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
  moneyDifferenceInCents,
  proposalTotalsMatch,
} from "../../../shared/draft-calculations.js";
import {
  draftWritableInputFromSource,
  type CreateDraftRequest,
  type DraftResponse,
  type UpdateDraftRequest,
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

export const TURN_IN_TRANSACTION_TYPE_KEY = [
  ["New", "A brand-new policy for a client or line we did not have before."],
  ["Renewal", "A policy we already hold, continuing into a new term with the client retained."],
  ["Rewrite", "The same retained client moved from one carrier to another for a coverage need."],
  ["Won Back", "A policy-specific client relationship was lost and later recaptured after a gap."],
  ["Cross-sale", "A new line of coverage added for an existing client."],
  ["Endorsement", "A mid-term change to an existing policy."],
  ["Audit", "A premium audit or true-up on an existing policy."],
] as const;

export function isStandardTurnInTransactionType(value: string): boolean {
  return (TURN_IN_TRANSACTION_TYPES as readonly string[]).includes(value);
}

export interface TurnInWording {
  calculatedTotalLabel: string;
  depositHint: string;
  depositLabel: string;
  invoiceTransaction: boolean;
  notesLabel: string;
  notesPlaceholder: string;
  proposalInputLabel: string;
  proposalInputPlaceholder: string;
  proposalSectionTitle: string;
}

const TRANSACTION_NOTES_WORDING: Readonly<Record<string, readonly [string, string]>> = {
  Audit: ["Audit detail", "e.g. Sales increased from $50k to $200k — additional premium due"],
  Endorsement: ["Endorsement detail", "e.g. Added 2026 excavator to existing inland marine policy"],
  Rewrite: ["Rewrite detail", "e.g. Moved from carrier A to carrier B — same coverage, better rate"],
  Renewal: ["Renewal notes", "e.g. Coverage unchanged, premium increased 8%"],
  New: ["New policy notes", "Optional — any relevant details about this new account"],
  "Cross-sale": ["Cross-sale detail", "e.g. Existing GL client — added commercial auto"],
};

export function getTurnInWording(transactionType: string): TurnInWording {
  const invoiceTransaction = isInvoiceTransaction(transactionType);
  const [notesLabel, notesPlaceholder] =
    TRANSACTION_NOTES_WORDING[transactionType] ?? ["Additional detail", "Any relevant notes"];
  return {
    calculatedTotalLabel: invoiceTransaction
      ? "WCIB Invoiced Total"
      : "Proposal total (incl. broker fee)",
    depositHint: invoiceTransaction
      ? "Deposit option from the carrier — if a balance will be financed"
      : "The deposit option shown on the proposal — for reference only",
    depositLabel: invoiceTransaction ? "Deposit option from carrier" : "Deposit option from quote",
    invoiceTransaction,
    notesLabel,
    notesPlaceholder,
    proposalInputLabel: invoiceTransaction
      ? "WCIB Invoiced Amount — the total amount on the WCIB invoice"
      : "Proposal total from quote — confirm the premium on the proposal",
    proposalInputPlaceholder: invoiceTransaction
      ? "Enter the WCIB invoiced amount"
      : "Enter the total premium shown on the proposal",
    proposalSectionTitle: invoiceTransaction
      ? "WCIB invoiced amount — verify against the invoice"
      : "Proposal total — verify against the quote",
  };
}

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

export function applyIpfsReturningDetection(
  state: TurnInFormState,
  hasPriorFinancing: boolean,
  userSelected: boolean,
): TurnInFormState {
  if (userSelected) return state;
  const ipfsReturning = hasPriorFinancing ? "returning" : "new";
  return state.ipfsReturning === ipfsReturning
    ? state
    : { ...state, ipfsReturning };
}

export { proposalTotalsMatch };

export interface TurnInPaymentGuidance {
  text: string;
  tone: "error" | "good" | "neutral";
}

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
  const isoDate = turnInDateToIso(effectiveDate);
  if (!annualPolicyType || isoDate === null) {
    return null;
  }
  const date = new Date(`${isoDate}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 2000) {
    return null;
  }
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return formatTurnInDateInput(date.toISOString().slice(0, 10));
}

export function normalizeTurnInDate(value: string): string {
  const raw = value.trim();
  if (raw === "") {
    return "";
  }
  if (/^\d+$/.test(raw)) {
    return digitDateToSlash(raw);
  }
  if (/^[0-9][0-9./\- ]*$/.test(raw)) {
    const parts = raw.split(/[^0-9]+/).filter(Boolean);
    if (parts.length === 2 || parts.length >= 3) {
      const [month, day, year] =
        parts.length >= 3
          ? [parts[0]!, parts[1]!, parts[2]!]
          : [parts[0]!, "1", parts[1]!];
      const formatted = datePartsToSlash(month, day, year);
      if (formatted !== null) {
        return formatted;
      }
    }
  }
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00`)
    : new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }
  return `${String(parsed.getMonth() + 1).padStart(2, "0")}/${String(parsed.getDate()).padStart(2, "0")}/${parsed.getFullYear()}`;
}

export function formatTurnInDateInput(value: string | null | undefined): string {
  return value == null || value === "" ? "" : normalizeTurnInDate(value);
}

export function turnInDateToIso(value: string): string | null {
  const normalized = normalizeTurnInDate(value);
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(normalized);
  if (match === null) {
    return null;
  }
  const [, month, day, year] = match;
  const iso = `${year}-${month}-${day}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso
    ? iso
    : null;
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
    effectiveDate: dateForApi(state.effectiveDate),
    expirationDate: dateForApi(state.expirationDate),
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

export function turnInFormHasContent(state: TurnInFormState): boolean {
  const input = turnInFormToDraftInput(state);
  return [
    input.accountAssignment,
    input.amountPaid,
    input.basePremium,
    input.brokerFee,
    input.carrierId,
    input.commissionRate,
    input.companyName,
    input.depositOption,
    input.effectiveDate,
    input.expirationDate,
    input.financeReference,
    input.insuredName,
    input.invoiceNumber,
    input.mgaId,
    input.notes,
    input.policyNumber,
    input.policyTypeId,
    input.proposalTotal,
    input.transactionNotes,
    input.transactionType,
  ].some((value) => value !== null && value !== undefined);
}

export function turnInFormToNonfinancialDraftUpdate(
  state: TurnInFormState,
): UpdateDraftRequest {
  return {
    accountAssignment: state.accountAssignment || null,
    carrierId: state.carrierId,
    companyName: textOrNull(state.companyName),
    effectiveDate: dateForApi(state.effectiveDate),
    expirationDate: dateForApi(state.expirationDate),
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
  return turnInStateFromWritableInput(draftWritableInputFromSource(draft));
}

export function turnInStateFromSubmission(
  submittedPayload: unknown,
): TurnInFormState {
  return turnInStateFromWritableInput(
    draftWritableInputFromSource(submittedPayload),
  );
}

function turnInStateFromWritableInput(
  draft: CreateDraftRequest,
): TurnInFormState {
  return {
    accountAssignment: draft.accountAssignment ?? "",
    amountPaid: draft.amountPaid ?? "",
    basePremium: draft.basePremium ?? "",
    brokerFee: draft.brokerFee ?? "",
    carrierId: draft.carrierId ?? null,
    commissionConfirmed: draft.commissionConfirmed ?? false,
    commissionMode: draft.commissionMode ?? "pct",
    commissionRate: draft.commissionRate ?? "",
    companyName: draft.companyName ?? "",
    depositOption: draft.depositOption ?? "",
    effectiveDate: formatTurnInDateInput(draft.effectiveDate),
    expirationDate: formatTurnInDateInput(draft.expirationDate),
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
    mgaId: draft.mgaId ?? null,
    notes: draft.notes ?? "",
    officeLocationId: draft.officeLocationId ?? null,
    paymentMode: draft.paymentMode ?? "full",
    policyNumber: draft.policyNumber ?? "",
    policyTypeId: draft.policyTypeId ?? null,
    producerUserId: draft.producerUserId ?? null,
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

export function getTurnInPaymentGuidance(
  state: TurnInFormState,
): TurnInPaymentGuidance | null {
  const summary = calculateTurnInSummary(state);
  if (
    summary.proposalTotal === null ||
    compareMoney(summary.proposalTotal, "0.00") !== 1 ||
    compareMoney(state.amountPaid, "0.00") !== 1
  ) {
    return null;
  }
  if (state.paymentMode === "full") {
    const difference = moneyDifferenceInCents(state.amountPaid, summary.proposalTotal);
    return difference !== null && difference < 2n
      ? { text: "Matches full proposal total", tone: "good" }
      : {
          text: `Full proposal total is ${formatGuidanceMoney(summary.proposalTotal)} — confirm this is correct`,
          tone: "error",
        };
  }
  const remaining = subtractMoney(summary.proposalTotal, state.amountPaid);
  if (remaining === null) {
    return null;
  }
  return state.paymentMode === "direct"
    ? {
        text: `Deposit collected · carrier direct-bills the remaining ${formatGuidanceMoney(remaining)} (not financed by us)`,
        tone: "neutral",
      }
    : {
        text: `Deposit · Balance of ${formatGuidanceMoney(remaining)} will be financed`,
        tone: "neutral",
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
    !proposalTotalsMatch(input.proposalTotal, summary.proposalTotal)
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

function dateForApi(value: string): string | null {
  const normalized = value.trim();
  return normalized === "" ? null : (turnInDateToIso(normalized) ?? normalized);
}

function digitDateToSlash(raw: string): string {
  let month: string;
  let day: string;
  let year: string;
  if (raw.length === 8) {
    month = raw.slice(0, 2);
    day = raw.slice(2, 4);
    year = raw.slice(4, 8);
  } else if (raw.length === 7) {
    month = raw.slice(0, 1);
    day = raw.slice(1, 3);
    year = raw.slice(3, 7);
  } else if (raw.length === 6) {
    const firstTwo = Number.parseInt(raw.slice(0, 2), 10);
    if (firstTwo >= 1 && firstTwo <= 12) {
      month = raw.slice(0, 2);
      day = raw.slice(2, 4);
      year = raw.slice(4, 6);
    } else {
      month = raw.slice(0, 1);
      day = raw.slice(1, 2);
      year = raw.slice(2, 6);
    }
  } else if (raw.length === 5) {
    month = raw.slice(0, 1);
    day = raw.slice(1, 3);
    year = raw.slice(3, 5);
  } else if (raw.length === 4) {
    month = raw.slice(0, 1);
    day = raw.slice(1, 2);
    year = raw.slice(2, 4);
  } else {
    return raw;
  }
  return datePartsToSlash(month, day, year) ?? raw;
}

function datePartsToSlash(month: string, day: string, year: string): string | null {
  const monthNumber = Number.parseInt(month, 10);
  const dayNumber = Number.parseInt(day, 10);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) {
    return null;
  }
  const normalizedYear = year.length <= 2
    ? `20${year.padStart(2, "0")}`
    : year.padStart(4, "0");
  return `${String(monthNumber).padStart(2, "0")}/${String(dayNumber).padStart(2, "0")}/${normalizedYear}`;
}

function moneyOrNull(value: string): string | null {
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function rateOrNull(value: string): string | null {
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function subtractMoney(left: string, right: string): string | null {
  const leftMatch = /^(\d+)\.(\d{2})$/.exec(left);
  const rightMatch = /^(\d+)\.(\d{2})$/.exec(right);
  if (leftMatch === null || rightMatch === null) {
    return null;
  }
  const leftCents = BigInt(leftMatch[1]!) * 100n + BigInt(leftMatch[2]!);
  const rightCents = BigInt(rightMatch[1]!) * 100n + BigInt(rightMatch[2]!);
  const difference = leftCents - rightCents;
  const sign = difference < 0n ? "-" : "";
  const absolute = difference < 0n ? -difference : difference;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

function formatGuidanceMoney(value: string): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    minimumFractionDigits: 2,
    style: "currency",
  }).format(Number(value));
}
