import type { CurrentUser } from "../../../shared/current-user.js";
import type { ApprovalWorkListResponse } from "../../../shared/approval-queue.js";
import {
  approveWithOverrideRequestSchema,
  type ApproveWithOverrideRequest,
} from "../../../shared/policy-overrides.js";

export interface ApprovalReviewField {
  key: string;
  label: string;
  money?: boolean;
}

export interface ApprovalReviewGroup {
  fields: readonly ApprovalReviewField[];
  title: string;
}

export const APPROVAL_REVIEW_GROUPS: readonly ApprovalReviewGroup[] = [
  {
    title: "Policy",
    fields: [
      { key: "insuredName", label: "Insured" },
      { key: "companyName", label: "Company" },
      { key: "policyNumber", label: "Policy number" },
      { key: "policyTypeId", label: "Policy type" },
      { key: "transactionType", label: "Transaction" },
      { key: "invoiceNumber", label: "Invoice number" },
      { key: "effectiveDate", label: "Effective" },
      { key: "expirationDate", label: "Expiration" },
      { key: "transactionNotes", label: "Transaction notes" },
      { key: "notes", label: "General notes" },
    ],
  },
  {
    title: "Placement",
    fields: [
      { key: "carrierId", label: "Carrier" },
      { key: "mgaId", label: "MGA" },
      { key: "officeLocationId", label: "Office" },
      { key: "accountAssignment", label: "Account assignment" },
      { key: "producerUserId", label: "Producer" },
      { key: "kayleeSplit", label: "Assignment classification" },
    ],
  },
  {
    title: "Premium and commission",
    fields: [
      { key: "basePremium", label: "Base premium", money: true },
      { key: "taxes", label: "Taxes", money: true },
      { key: "mgaFee", label: "MGA fee", money: true },
      { key: "brokerFee", label: "Broker fee", money: true },
      { key: "proposalTotal", label: "Proposal total", money: true },
      { key: "amountPaid", label: "Amount collected", money: true },
      { key: "commissionMode", label: "Commission mode" },
      { key: "commissionRate", label: "Commission rate" },
      { key: "commissionAmount", label: "Agency commission", money: true },
      { key: "commissionConfirmed", label: "Commission confirmed" },
      { key: "netDue", label: "Net due to MGA", money: true },
    ],
  },
  {
    title: "Payment and financing",
    fields: [
      { key: "paymentMode", label: "Payment mode" },
      { key: "depositOption", label: "Deposit", money: true },
      { key: "financeBalance", label: "Financed balance", money: true },
      { key: "financeReference", label: "Finance reference" },
      { key: "ipfsFinanced", label: "IPFS financed" },
      { key: "ipfsReturning", label: "IPFS customer" },
      { key: "ipfsManual", label: "Manual IPFS entry" },
      { key: "financeContact", label: "Finance contact" },
      { key: "financeMeta", label: "Finance metadata" },
      { key: "schemaVersion", label: "Schema version" },
    ],
  },
] as const;

export type ApprovalResolutionTarget =
  | { id: string; kind: "change_request" }
  | { id: string; kind: "help" }
  | { id: string; kind: "submission" };

export interface ApprovalValueLookups {
  carriers?: ReadonlyMap<string, string>;
  mgas?: ReadonlyMap<string, string>;
  offices?: ReadonlyMap<string, string>;
  policyTypes?: ReadonlyMap<string, string>;
}

export function isApprovalAdmin(user: CurrentUser): boolean {
  return user.role === "admin" && user.capabilities.includes("admin");
}

export function removeResolvedApprovalWork(
  work: ApprovalWorkListResponse,
  target: ApprovalResolutionTarget,
): ApprovalWorkListResponse {
  return target.kind === "submission"
    ? {
        ...work,
        submissions: work.submissions.filter(
          ({ entry }) => entry.id !== target.id,
        ),
      }
    : target.kind === "help"
      ? {
        ...work,
        helpRequests: work.helpRequests.filter(
          ({ draft }) => draft.id !== target.id,
        ),
      }
      : {
          ...work,
          changeRequests: work.changeRequests.filter(
            ({ request }) => request.id !== target.id,
          ),
        };
}

export function buildApprovalOverrideInput(input: {
  brokerFee: string;
  commissionAmount: string;
  netDue: string;
  reason: string;
}):
  | { input: ApproveWithOverrideRequest; success: true }
  | { success: false } {
  const replacementValues = Object.fromEntries(
    ["commissionAmount", "brokerFee", "netDue"]
      .map((field) => [field, input[field as keyof typeof input].trim()])
      .filter(([, value]) => value !== ""),
  );
  const parsed = approveWithOverrideRequestSchema.safeParse({
    changedFields: Object.keys(replacementValues),
    reason: input.reason,
    replacementValues,
  });
  return parsed.success
    ? { input: parsed.data, success: true }
    : { success: false };
}

export function reviewSourceValue(
  source: Readonly<Record<string, unknown>>,
  field: ApprovalReviewField,
  lookups: ApprovalValueLookups = {},
): string {
  const raw =
    field.key === "commissionAmount" && !(field.key in source)
      ? source.agencyCommissionAmount
      : source[field.key];
  if (raw === null || raw === undefined || raw === "") {
    return "Not set";
  }
  if (field.key === "carrierId" && typeof raw === "string") {
    return lookups.carriers?.get(raw) ?? raw;
  }
  if (field.key === "mgaId" && typeof raw === "string") {
    return lookups.mgas?.get(raw) ?? raw;
  }
  if (field.key === "officeLocationId" && typeof raw === "string") {
    return lookups.offices?.get(raw) ?? raw;
  }
  if (field.key === "policyTypeId" && typeof raw === "string") {
    return lookups.policyTypes?.get(raw) ?? raw;
  }
  if (typeof raw === "boolean") {
    return raw ? "Yes" : "No";
  }
  if (field.money && typeof raw === "string" && /^\d+\.\d{2}$/.test(raw)) {
    return new Intl.NumberFormat("en-US", {
      currency: "USD",
      style: "currency",
    }).format(Number(raw));
  }
  if (field.key === "commissionRate" && typeof raw === "string") {
    return `${Number(raw).toFixed(2)}%`;
  }
  if (field.key === "accountAssignment" || field.key === "kayleeSplit") {
    return assignmentLabel(String(raw));
  }
  if (field.key === "paymentMode") {
    return paymentModeLabel(String(raw));
  }
  if (field.key === "commissionMode") {
    return commissionModeLabel(String(raw));
  }
  if (field.key === "financeContact" && isRecord(raw)) {
    return [raw.email, raw.mobile, raw.address]
      .filter((value): value is string => typeof value === "string" && value !== "")
      .join(" | ") || "Not set";
  }
  if (field.key === "financeMeta" && isRecord(raw)) {
    return [raw.billingType, raw.loanType]
      .filter((value): value is string => typeof value === "string" && value !== "")
      .join(" / ") || "Not set";
  }
  return String(raw);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assignmentLabel(value: string): string {
  return value === "house"
    ? "First-year house"
    : value === "book"
      ? "Producer account"
      : "Sophia house account";
}

function paymentModeLabel(value: string): string {
  return value === "deposit"
    ? "Deposit / financed"
    : value === "direct"
      ? "Direct bill"
      : "Paid in full";
}

function commissionModeLabel(value: string): string {
  return value === "pct" ? "Percentage" : value.toUpperCase();
}
