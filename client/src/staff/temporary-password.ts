import { isPasswordPolicySatisfied } from "../../../shared/password-policy.js";

const FIRST_WORDS = [
  "Harbor",
  "Maple",
  "Meadow",
  "Ocean",
  "River",
  "Silver",
  "Sunrise",
  "Willow",
] as const;

const SECOND_WORDS = [
  "Anchor",
  "Cedar",
  "Garden",
  "Lantern",
  "Market",
  "Orchard",
  "Pebble",
  "Window",
] as const;

const THIRD_WORDS = [
  "Bridge",
  "Compass",
  "Horizon",
  "Notebook",
  "Signal",
  "Spruce",
  "Station",
  "Trail",
] as const;

export type RandomIndex = (upperBound: number) => number;

export function generateTemporaryPassphrase(
  randomIndex: RandomIndex = secureRandomIndex,
): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const passphrase = [
      pick(FIRST_WORDS, randomIndex),
      pick(SECOND_WORDS, randomIndex),
      pick(THIRD_WORDS, randomIndex),
      String(10 + randomIndex(90)),
    ].join("-");
    if (isPasswordPolicySatisfied(passphrase)) return passphrase;
  }
  throw new Error("Unable to generate a policy-compliant temporary password");
}

function pick(
  values: readonly string[],
  randomIndex: RandomIndex,
): string {
  return values[randomIndex(values.length)] ?? values[0]!;
}

function secureRandomIndex(upperBound: number): number {
  if (!Number.isInteger(upperBound) || upperBound <= 0) {
    throw new RangeError("Random index upper bound must be a positive integer");
  }
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return (random[0] ?? 0) % upperBound;
}
