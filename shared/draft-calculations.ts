import type { CommissionMode, PaymentMode } from "./policy-fields.js";

export interface AgencyCommissionInput {
  basePremium: string | null | undefined;
  commissionMode: CommissionMode | null | undefined;
  commissionRate: string | null | undefined;
}

export function calculateAgencyCommissionAmount(
  input: AgencyCommissionInput,
): string | null {
  if (input.commissionMode === "tbd" || input.commissionMode === "na") {
    return "0.00";
  }
  if (
    input.commissionMode !== "pct" ||
    input.basePremium == null ||
    input.commissionRate == null
  ) {
    return null;
  }

  const baseCents = parseFixed(input.basePremium, 2);
  const rateUnits = parseFixed(input.commissionRate, 4);
  if (baseCents === null || rateUnits === null) {
    return null;
  }
  return formatCents(roundDivision(baseCents * rateUnits, 1_000_000n));
}

export function calculateDraftNetDue(input: {
  agencyCommissionAmount: string | null;
  amountPaid: string | null | undefined;
  brokerFee: string | null | undefined;
}): string | null {
  if (
    input.agencyCommissionAmount === null ||
    input.amountPaid == null ||
    input.brokerFee == null
  ) {
    return null;
  }
  const amountPaid = parseFixed(input.amountPaid, 2);
  const brokerFee = parseFixed(input.brokerFee, 2);
  const commission = parseFixed(input.agencyCommissionAmount, 2);
  if (amountPaid === null || brokerFee === null || commission === null) {
    return null;
  }
  return formatCents(amountPaid - brokerFee - commission);
}

export function calculateDraftFinanceBalance(input: {
  amountPaid: string | null | undefined;
  paymentMode: PaymentMode | null | undefined;
  proposalTotal: string | null | undefined;
}): string | null {
  if (input.paymentMode === "full" || input.paymentMode === "direct") {
    return "0.00";
  }
  if (
    input.paymentMode !== "deposit" ||
    input.amountPaid == null ||
    input.proposalTotal == null
  ) {
    return null;
  }
  const proposalTotal = parseFixed(input.proposalTotal, 2);
  const amountPaid = parseFixed(input.amountPaid, 2);
  if (proposalTotal === null || amountPaid === null) {
    return null;
  }
  const balance = proposalTotal - amountPaid;
  return balance < 0n ? null : formatCents(balance);
}

export function calculateDraftProposalTotal(input: {
  basePremium: string | null | undefined;
  brokerFee: string | null | undefined;
  mgaFee: string | null | undefined;
  taxes: string | null | undefined;
}): string | null {
  const amounts = [
    input.basePremium ?? "0.00",
    input.taxes ?? "0.00",
    input.mgaFee ?? "0.00",
    input.brokerFee,
  ].map((value) => (value == null ? null : parseFixed(value, 2)));
  if (amounts.some((value) => value === null)) {
    return null;
  }
  return formatCents(
    amounts.reduce<bigint>((total, value) => total + (value ?? 0n), 0n),
  );
}

export function compareMoney(
  left: string,
  right: string,
): -1 | 0 | 1 | null {
  const leftCents = parseFixed(left, 2);
  const rightCents = parseFixed(right, 2);
  if (leftCents === null || rightCents === null) {
    return null;
  }
  return leftCents < rightCents ? -1 : leftCents > rightCents ? 1 : 0;
}

function parseFixed(value: string, scale: number): bigint | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (match === null) {
    return null;
  }
  const fraction = (match[3] ?? "").padEnd(scale, "0");
  if (fraction.length > scale) {
    return null;
  }
  const magnitude =
    BigInt(match[2] ?? "0") * 10n ** BigInt(scale) +
    BigInt(fraction || "0");
  return match[1] === "-" ? -magnitude : magnitude;
}

function roundDivision(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function formatCents(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  const amount = `${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
  return value < 0n ? `-${amount}` : amount;
}
