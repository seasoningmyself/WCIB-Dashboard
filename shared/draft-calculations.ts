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
