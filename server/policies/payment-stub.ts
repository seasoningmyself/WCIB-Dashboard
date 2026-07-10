export interface PolicyPaymentInputs {
  collectedToDate: string;
  netDueTotal: string;
  premiumTotal: string;
  remittedToMga: string;
}

export interface PolicyPaymentBalances {
  balanceDueFromInsured: string;
  remainingNetDue: string;
}

export function calculatePolicyPaymentBalances(
  input: Readonly<PolicyPaymentInputs>,
): PolicyPaymentBalances {
  const balanceDueFromInsured =
    parseMoney(input.premiumTotal) - parseMoney(input.collectedToDate);
  const remainingNetDue =
    parseMoney(input.netDueTotal) - parseMoney(input.remittedToMga);

  if (balanceDueFromInsured < 0n || remainingNetDue < 0n) {
    throw new RangeError("Payment inputs cannot produce a negative balance");
  }

  return {
    balanceDueFromInsured: formatMoney(balanceDueFromInsured),
    remainingNetDue: formatMoney(remainingNetDue),
  };
}

function parseMoney(value: string): bigint {
  const match = /^(0|[1-9][0-9]{0,11})(?:\.([0-9]{1,2}))?$/.exec(value);
  if (match === null) {
    throw new TypeError("Payment input must be a nonnegative decimal amount");
  }

  const whole = match[1];
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return BigInt(whole) * 100n + BigInt(fraction || "0");
}

function formatMoney(cents: bigint): string {
  const whole = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}
