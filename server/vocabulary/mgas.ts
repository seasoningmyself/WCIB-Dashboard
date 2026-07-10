import {
  evaluateAccess,
  type AccessDenialReason,
  type AccessPrincipal,
} from "../auth/access.js";

export const MGA_SIMILARITY_THRESHOLD = 0.75;

export interface EvaluateMgaAdditionInput {
  candidateName: string;
  existingNames: readonly string[];
  nearDuplicateConfirmed?: boolean;
  principal: AccessPrincipal;
}

export type MgaAdditionDecision =
  | { kind: "denied"; reason: AccessDenialReason }
  | { kind: "invalid"; reason: "blank_name" }
  | { kind: "duplicate"; name: string }
  | { kind: "confirmation_required"; name: string; similarNames: string[] }
  | { kind: "ready"; name: string; similarNames: string[] };

export function calculateMgaNameSimilarity(a: string, b: string): number {
  const normalizedA = a.toLowerCase();
  const normalizedB = b.toLowerCase();
  if (normalizedA === normalizedB) {
    return 1;
  }
  if (normalizedA.length < 2 || normalizedB.length < 2) {
    return 0;
  }

  const longer =
    normalizedA.length > normalizedB.length ? normalizedA : normalizedB;
  const shorter =
    normalizedA.length > normalizedB.length ? normalizedB : normalizedA;
  if (longer.includes(shorter)) {
    return shorter.length / longer.length;
  }

  let commonCharacters = 0;
  const remainingCharacters = normalizedB.split("");
  for (const character of normalizedA) {
    const matchIndex = remainingCharacters.indexOf(character);
    if (matchIndex >= 0) {
      commonCharacters += 1;
      remainingCharacters.splice(matchIndex, 1);
    }
  }

  return (2 * commonCharacters) / (normalizedA.length + normalizedB.length);
}

export function evaluateMgaAddition(
  input: EvaluateMgaAdditionInput,
): MgaAdditionDecision {
  const access = evaluateAccess(input.principal, {
    capabilities: ["admin"],
  });
  if (!access.allowed) {
    return { kind: "denied", reason: access.reason };
  }

  const name = input.candidateName.trim();
  if (name.length === 0) {
    return { kind: "invalid", reason: "blank_name" };
  }

  const normalizedName = name.toLowerCase();
  if (
    input.existingNames.some(
      (existingName) => existingName.toLowerCase() === normalizedName,
    )
  ) {
    return { kind: "duplicate", name };
  }

  const similarNames = input.existingNames.filter(
    (existingName) =>
      calculateMgaNameSimilarity(existingName, name) >=
      MGA_SIMILARITY_THRESHOLD,
  );
  if (similarNames.length > 0 && input.nearDuplicateConfirmed !== true) {
    return { kind: "confirmation_required", name, similarNames };
  }

  return { kind: "ready", name, similarNames };
}
