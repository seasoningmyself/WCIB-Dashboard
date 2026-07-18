import { accountAssignmentLabel } from "../../../shared/account-assignment-labels.js";
import type { CurrentUser } from "../../../shared/current-user.js";
import {
  POLICY_CORRECTION_FIELDS,
  policyLedgerCorrectionRequestSchema,
  type PolicyCorrectionField,
  type PolicyLedgerCorrectionRequest,
} from "../../../shared/policy-corrections.js";
import type {
  PolicyLedgerItem,
  PolicyLedgerPolicy,
} from "../../../shared/policy-ledger.js";
import { POLICY_OVERRIDE_FIELDS } from "../../../shared/policy-overrides.js";

export interface LedgerBadge {
  label: string;
  tone: "danger" | "finance" | "muted" | "positive" | "review";
}

export interface LedgerDetailField {
  key: keyof PolicyLedgerPolicy;
  label: string;
  kind?: "date" | "money" | "rate" | "timestamp";
}

export interface LedgerDetailGroup {
  fields: readonly LedgerDetailField[];
  title: string;
}

export type GeneralEditorKind =
  | "assignment"
  | "boolean"
  | "carrier"
  | "date"
  | "finance_contact"
  | "finance_meta"
  | "ipfs_customer"
  | "ipfs_financed"
  | "money"
  | "mga"
  | "office"
  | "payment_mode"
  | "policy_type"
  | "producer"
  | "rate"
  | "text"
  | "textarea";

export interface GeneralEditorField {
  field: PolicyCorrectionField;
  kind: GeneralEditorKind;
  label: string;
  nullable?: boolean;
}

export interface GeneralEditorGroup {
  fields: readonly GeneralEditorField[];
  title: string;
}

export const GENERAL_EDITOR_GROUPS: readonly GeneralEditorGroup[] = [
  {
    title: "Policy identity",
    fields: [
      { field: "insuredName", kind: "text", label: "Insured" },
      { field: "companyName", kind: "text", label: "Company", nullable: true },
      { field: "policyNumber", kind: "text", label: "Policy number" },
      { field: "policyTypeId", kind: "policy_type", label: "Policy type" },
      { field: "transactionType", kind: "text", label: "Transaction type" },
      { field: "invoiceNumber", kind: "text", label: "Invoice number", nullable: true },
      { field: "effectiveDate", kind: "date", label: "Effective date" },
      { field: "expirationDate", kind: "date", label: "Expiration date" },
      { field: "transactionNotes", kind: "textarea", label: "Transaction notes", nullable: true },
      { field: "notes", kind: "textarea", label: "General notes", nullable: true },
    ],
  },
  {
    title: "Placement",
    fields: [
      { field: "carrierId", kind: "carrier", label: "Carrier" },
      { field: "mgaId", kind: "mga", label: "MGA" },
      { field: "officeLocationId", kind: "office", label: "Office" },
      { field: "accountAssignment", kind: "assignment", label: "Account assignment" },
      { field: "producerUserId", kind: "producer", label: "Producer", nullable: true },
      { field: "kayleeSplit", kind: "assignment", label: "Assignment classification" },
    ],
  },
  {
    title: "Premium inputs",
    fields: [
      { field: "basePremium", kind: "money", label: "Base premium" },
      { field: "taxes", kind: "money", label: "Taxes" },
      { field: "mgaFee", kind: "money", label: "MGA fee" },
      { field: "commissionRate", kind: "rate", label: "Commission rate", nullable: true },
      { field: "commissionConfirmed", kind: "boolean", label: "Commission confirmed" },
      { field: "amountPaid", kind: "money", label: "Amount collected" },
    ],
  },
  {
    title: "Financing",
    fields: [
      { field: "paymentMode", kind: "payment_mode", label: "Payment mode" },
      { field: "depositOption", kind: "money", label: "Deposit" },
      { field: "financeReference", kind: "text", label: "Finance reference", nullable: true },
      { field: "ipfsFinanced", kind: "ipfs_financed", label: "IPFS financed", nullable: true },
      { field: "ipfsManual", kind: "boolean", label: "Manual IPFS entry" },
      { field: "ipfsReturning", kind: "ipfs_customer", label: "IPFS customer", nullable: true },
      { field: "financeContact", kind: "finance_contact", label: "Finance contact", nullable: true },
      { field: "financeMeta", kind: "finance_meta", label: "Finance metadata", nullable: true },
    ],
  },
] as const;

export const LEDGER_DETAIL_GROUPS: readonly LedgerDetailGroup[] = [
  {
    title: "Policy",
    fields: [
      { key: "insuredName", label: "Insured" },
      { key: "companyName", label: "Company" },
      { key: "policyNumber", label: "Policy number" },
      { key: "transactionType", label: "Transaction" },
      { key: "invoiceNumber", label: "Invoice" },
      { key: "effectiveDate", kind: "date", label: "Effective" },
      { key: "expirationDate", kind: "date", label: "Expiration" },
      { key: "transactionNotes", label: "Transaction notes" },
      { key: "notes", label: "Notes" },
    ],
  },
  {
    title: "Agency financials",
    fields: [
      { key: "basePremium", kind: "money", label: "Base premium" },
      { key: "taxes", kind: "money", label: "Taxes" },
      { key: "mgaFee", kind: "money", label: "MGA fee" },
      { key: "brokerFee", kind: "money", label: "Broker fee" },
      { key: "proposalTotal", kind: "money", label: "Proposal total" },
      { key: "amountPaid", kind: "money", label: "Amount collected" },
      { key: "commissionMode", label: "Commission mode" },
      { key: "commissionRate", kind: "rate", label: "Commission rate" },
      { key: "commissionAmount", kind: "money", label: "Agency commission" },
      { key: "netDue", kind: "money", label: "Net due" },
    ],
  },
  {
    title: "Financing and MGA",
    fields: [
      { key: "paymentMode", label: "Payment mode" },
      { key: "depositOption", kind: "money", label: "Deposit" },
      { key: "financeBalance", kind: "money", label: "Financed balance" },
      { key: "financeReference", label: "Finance reference" },
      { key: "ipfsFinanced", label: "IPFS financed" },
      { key: "ipfsReturning", label: "IPFS customer" },
      { key: "ipfsManual", label: "Manual IPFS" },
      { key: "ipfsPushed", label: "IPFS pushed" },
      { key: "mgaPaid", label: "MGA paid" },
      { key: "mgaPayReference", label: "MGA pay reference" },
      { key: "mgaPaidAt", kind: "timestamp", label: "MGA paid at" },
    ],
  },
  {
    title: "Record",
    fields: [
      { key: "submittedAt", kind: "timestamp", label: "Submitted" },
      { key: "approvedAt", kind: "timestamp", label: "Approved" },
      { key: "updatedAt", kind: "timestamp", label: "Last corrected" },
    ],
  },
] as const;

export function isPolicyLedgerAdmin(user: CurrentUser): boolean {
  return user.role === "admin" && user.capabilities.includes("admin");
}

export function currentLedgerMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export function formatMoneyExact(value: string): string {
  const match = /^(0|[1-9][0-9]*)\.([0-9]{2})$/.exec(value);
  if (match === null) return value;
  const grouped = match[1]!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${grouped}.${match[2]}`;
}

export function addMoneyExact(left: string, right: string): string {
  return centsToMoney(moneyToCents(left) + moneyToCents(right));
}

export function ledgerAccountLabel(item: PolicyLedgerItem): string {
  return accountAssignmentLabel(
    item.policy.kayleeSplit,
    item.labels.producerDisplayName,
  );
}

export function ledgerBadges(item: PolicyLedgerItem): readonly LedgerBadge[] {
  const badges: LedgerBadge[] = [];
  if (item.policy.overridden) {
    badges.push({ label: "Override", tone: "review" });
  }
  if (item.duplicate !== null) {
    badges.push({
      label:
        item.duplicate.kind === "likely"
          ? `Likely duplicate (${item.duplicate.count})`
          : `Possible duplicate (${item.duplicate.count})`,
      tone: "danger",
    });
  }
  if (item.policy.paymentMode === "deposit") {
    badges.push({
      label:
        item.policy.ipfsFinanced === "yes"
          ? item.policy.ipfsManual
            ? "IPFS manual"
            : item.policy.ipfsPushed
              ? "IPFS ✓"
              : "IPFS pending"
          : "Financed",
      tone:
        item.policy.ipfsFinanced === "yes" && item.policy.ipfsPushed
          ? "positive"
          : "finance",
    });
  }
  badges.push(
    item.policy.mgaPaid
      ? { label: "MGA paid", tone: "positive" }
      : { label: "MGA unpaid", tone: "muted" },
  );
  return badges;
}

export function ledgerDetailValue(
  item: PolicyLedgerItem,
  field: LedgerDetailField,
): string {
  const { policy } = item;
  const value = policy[field.key];
  if (field.key === "accountAssignment" || field.key === "kayleeSplit") {
    return accountAssignmentLabel(
      policy[field.key],
      item.labels.producerDisplayName,
    );
  }
  if (field.key === "producerUserId") {
    return item.labels.producerDisplayName ?? "Not set";
  }
  if (value === null || value === "") return "Not set";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (field.kind === "money" && typeof value === "string") {
    return formatMoneyExact(value);
  }
  if (field.kind === "rate" && typeof value === "string") {
    return `${value.replace(/\.0+$|(?<=\.[0-9]*[1-9])0+$/g, "")}%`;
  }
  if ((field.kind === "date" || field.kind === "timestamp") && typeof value === "string") {
    const date = new Date(field.kind === "date" ? `${value}T00:00:00.000Z` : value);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        ...(field.kind === "timestamp" ? { timeStyle: "short" as const } : {}),
        timeZone: "UTC",
      }).format(date);
    }
  }
  if (typeof value === "object") {
    if (field.key === "financeContact") {
      const record = value as Record<string, unknown>;
      return [record.email, record.mobile, record.address]
        .filter((entry): entry is string => typeof entry === "string" && entry !== "")
        .join(" | ") || "Not set";
    }
    return "Recorded";
  }
  return String(value);
}

export function policyCorrectionValues(
  policy: PolicyLedgerPolicy,
): Record<PolicyCorrectionField, unknown> {
  return Object.fromEntries(
    POLICY_CORRECTION_FIELDS.map((field) => [field, policy[field]]),
  ) as Record<PolicyCorrectionField, unknown>;
}

export function buildGeneralCorrectionRequest(
  policy: PolicyLedgerPolicy,
  values: Readonly<Record<PolicyCorrectionField, unknown>>,
  reason: string,
): { input: PolicyLedgerCorrectionRequest; success: true } | { success: false } {
  const changedFields = POLICY_CORRECTION_FIELDS.filter(
    (field) => !sameValue(policy[field], values[field]),
  );
  const replacementValues = Object.fromEntries(
    changedFields.map((field) => [field, values[field]]),
  );
  const parsed = policyLedgerCorrectionRequestSchema.safeParse({
    change: { changedFields, reason, replacementValues },
    expectedUpdatedAt: policy.updatedAt,
    kind: "general",
  });
  return parsed.success
    ? { input: parsed.data, success: true }
    : { success: false };
}

export function buildOverrideCorrectionRequest(
  policy: PolicyLedgerPolicy,
  values: Readonly<Record<(typeof POLICY_OVERRIDE_FIELDS)[number], string>>,
  reason: string,
): { input: PolicyLedgerCorrectionRequest; success: true } | { success: false } {
  const changedFields = POLICY_OVERRIDE_FIELDS.filter(
    (field) => values[field] !== policy[field],
  );
  const replacementValues = Object.fromEntries(
    changedFields.map((field) => [field, values[field]]),
  );
  const parsed = policyLedgerCorrectionRequestSchema.safeParse({
    change: { changedFields, reason, replacementValues },
    expectedUpdatedAt: policy.updatedAt,
    kind: "override",
  });
  return parsed.success
    ? { input: parsed.data, success: true }
    : { success: false };
}

export function generalEditorFields(): readonly PolicyCorrectionField[] {
  return GENERAL_EDITOR_GROUPS.flatMap(({ fields }) =>
    fields.map(({ field }) => field),
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function moneyToCents(value: string): bigint {
  const match = /^(0|[1-9][0-9]*)\.([0-9]{2})$/.exec(value);
  if (match === null) return 0n;
  return BigInt(match[1]!) * 100n + BigInt(match[2]!);
}

function centsToMoney(value: bigint): string {
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}
