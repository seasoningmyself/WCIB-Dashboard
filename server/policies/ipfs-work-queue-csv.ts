import {
  type PolicyLedgerLabels,
  type PolicyLedgerPolicy,
} from "../../shared/policy-ledger.js";
import { accountAssignmentLabel } from "../../shared/account-assignment-labels.js";
import { safeSpreadsheetText } from "../pay-sheets/export-document.js";
import type { PolicyFinancialSplit } from "./ledger.js";

export interface ProjectedIpfsWorkQueueRow extends PolicyFinancialSplit {
  labels: PolicyLedgerLabels;
  policy: PolicyLedgerPolicy;
}

type CsvValue = (row: ProjectedIpfsWorkQueueRow) => string;

const COLUMNS: readonly (readonly [string, CsvValue])[] = [
  ["Record ID", ({ policy }) => policy.id],
  ["Insured (business name)", ({ policy }) => policy.insuredName],
  ["IPFS Policy #", ({ policy }) => policy.policyNumber || "PENDING"],
  ["IPFS Coverage", ({ labels }) => labels.policyTypeName],
  ["IPFS Company (carrier)", ({ labels }) => labels.carrierName],
  ["IPFS General Agent (MGA)", ({ labels }) => labels.mgaName],
  ["IPFS Eff date", ({ policy }) => policy.effectiveDate],
  ["IPFS Exp date", ({ policy }) => policy.expirationDate],
  ["IPFS Premium", ({ policy }) => policy.basePremium],
  ["IPFS Taxes", ({ policy }) => policy.taxes],
  ["IPFS Fees (Broker + MGA combined)", ({ policy }) => addMoney(policy.brokerFee, policy.mgaFee)],
  ["IPFS Total Premium", ({ policy }) => policy.proposalTotal],
  ["IPFS Min Earned %", () => "0.000"],
  ["IPFS Min Earned $", () => "0.00"],
  ["IPFS Down $ (collected)", ({ policy }) => policy.amountPaid],
  ["IPFS Cancel Days", () => "10"],
  ["IPFS Billing type", () => "Invoice"],
  ["IPFS Loan type", () => "Commercial"],
  ["IPFS Program Name", () => "WESTCOAST"],
  ["IPFS All Tax In Down", () => "No"],
  ["IPFS Doc Stamp", () => "No"],
  ["IPFS Underwriting Broker Fee (ALWAYS 0)", () => "0.00"],
  ["Financed amount", ({ policy }) => financedAmount(policy)],
  ["Finance confirmation #", ({ policy }) => policy.financeReference ?? ""],
  ["IPFS Insured name (from policy information)", ({ policy }) => policy.insuredName],
  ["IPFS insured status", ({ policy }) => ipfsCustomerStatus(policy.ipfsReturning)],
  ["IPFS Contact phone (mobile)", ({ policy }) => financeContactValue(policy.financeContact, "mobile")],
  ["IPFS Contact email", ({ policy }) => financeContactValue(policy.financeContact, "email")],
  ["IPFS Insured mailing address", ({ policy }) => financeContactValue(policy.financeContact, "address")],
  ["Pushed through to IPFS", ({ policy }) => policy.ipfsPushed ? "Yes" : "No"],
  ["Pushed date", ({ policy }) => policy.ipfsPushedAt?.slice(0, 10) ?? ""],
  ["MGA fee (WCIB internal)", ({ policy }) => policy.mgaFee],
  ["Broker fee (WCIB internal)", ({ policy }) => policy.brokerFee],
  ["Commission (WCIB internal)", ({ policy }) => commissionValue(policy)],
  ["Commission rate % (WCIB internal)", ({ policy }) => commissionRateValue(policy)],
  ["Net due to MGA (WCIB internal)", ({ policy }) => policy.netDue],
  ["Producer share (WCIB internal)", ({ producerPayout }) => producerPayout],
  ["Sophia retained (WCIB internal)", ({ sophiaRetained }) => sophiaRetained],
  ["Account (WCIB internal)", accountLabel],
  ["Office (WCIB internal)", ({ labels }) => labels.officeName],
  ["Transaction (WCIB internal)", ({ policy }) => policy.transactionType],
  ["Invoice # (WCIB internal)", ({ policy }) => policy.invoiceNumber ?? ""],
  ["Submitted by (WCIB internal)", ({ labels }) => labels.submitterDisplayName],
  ["Approved date (WCIB internal)", ({ policy }) => policy.approvedAt.slice(0, 10)],
  ["MGA paid (WCIB internal)", ({ policy }) => policy.mgaPaid ? "Yes" : "No"],
  ["MGA pay ref (WCIB internal)", ({ policy }) => policy.mgaPayReference ?? ""],
  ["Notes (WCIB internal)", ({ policy }) => policy.notes ?? ""],
];

export const IPFS_WORK_QUEUE_HEADERS = Object.freeze(
  COLUMNS.map(([header]) => header),
);

export function* ipfsWorkQueueCsvChunks(
  rows: readonly ProjectedIpfsWorkQueueRow[],
): Generator<string> {
  yield `\ufeff${IPFS_WORK_QUEUE_HEADERS.map(csvCell).join(",")}`;
  for (const row of rows) {
    yield `\r\n${COLUMNS.map(([, value]) => csvCell(value(row))).join(",")}`;
  }
}

export function renderIpfsWorkQueueCsv(
  rows: readonly ProjectedIpfsWorkQueueRow[],
): string {
  return [...ipfsWorkQueueCsvChunks(rows)].join("");
}

function csvCell(value: string): string {
  const safe = safeSpreadsheetText(value);
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function moneyToCents(value: string): bigint {
  const match = /^(0|[1-9][0-9]*)\.([0-9]{2})$/.exec(value);
  if (match === null) throw new Error("Invalid projected money value");
  return BigInt(match[1]!) * 100n + BigInt(match[2]!);
}

function centsToMoney(value: bigint): string {
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

function addMoney(left: string, right: string): string {
  return centsToMoney(moneyToCents(left) + moneyToCents(right));
}

function financedAmount(policy: PolicyLedgerPolicy): string {
  const stored = moneyToCents(policy.financeBalance);
  if (stored > 0n) return centsToMoney(stored);
  const calculated = moneyToCents(policy.proposalTotal) - moneyToCents(policy.amountPaid);
  return centsToMoney(calculated > 0n ? calculated : 0n);
}

function commissionValue(policy: PolicyLedgerPolicy): string {
  return policy.commissionMode === "pct"
    ? policy.commissionAmount
    : policy.commissionMode.toUpperCase();
}

function commissionRateValue(policy: PolicyLedgerPolicy): string {
  if (policy.commissionMode !== "pct" || policy.commissionRate === null) return "";
  return Number(policy.commissionRate).toFixed(2);
}

function accountLabel(row: ProjectedIpfsWorkQueueRow): string {
  const { policy, labels } = row;
  return accountAssignmentLabel(
    policy.kayleeSplit,
    labels.producerDisplayName,
  );
}

function ipfsCustomerStatus(value: PolicyLedgerPolicy["ipfsReturning"]): string {
  if (value === "returning") {
    return "Returning - link to existing IPFS account (keep auto-pay)";
  }
  return value === "new" ? "New IPFS insured - create account" : "";
}

function financeContactValue(
  contact: PolicyLedgerPolicy["financeContact"],
  key: "address" | "email" | "mobile",
): string {
  if (contact === null || typeof contact !== "object" || Array.isArray(contact)) return "";
  const value = contact[key];
  return typeof value === "string" ? value : "";
}
