import {
  evaluateAccess,
  type AccessDenialReason,
  type AccessPrincipal,
} from "../auth/access.js";
import {
  isPolicyTypeClass,
  type PolicyTypeClass,
} from "../../shared/policy-types.js";
import { VOCABULARY_USER_ACCESS } from "./access.js";

export const VOCABULARY_ADD_ACCESS = VOCABULARY_USER_ACCESS;

type VocabularyDenialReason = "unauthenticated" | AccessDenialReason;

type CommonVocabularyDecision<TRecord> =
  | { kind: "denied"; reason: VocabularyDenialReason }
  | { kind: "invalid"; reason: "blank_name" }
  | { kind: "duplicate"; name: string }
  | { kind: "ready"; record: TRecord };

export type CarrierAdditionDecision = CommonVocabularyDecision<{
  name: string;
}>;

export type PolicyTypeAdditionDecision =
  | CommonVocabularyDecision<{
      classTag: PolicyTypeClass;
      name: string;
    }>
  | { kind: "invalid"; reason: "class_required" | "unknown_class" };

interface CommonVocabularyInput {
  candidateName: string;
  existingNames: readonly string[];
  principal: AccessPrincipal | null;
}

export interface PolicyTypeAdditionInput extends CommonVocabularyInput {
  classTag: unknown;
}

export function evaluateCarrierAddition(
  input: CommonVocabularyInput,
): CarrierAdditionDecision {
  const denied = evaluateVocabularyAccess(input.principal);
  if (denied !== null) {
    return denied;
  }

  const nameDecision = evaluateName(input.candidateName, input.existingNames);
  return nameDecision.kind === "ready"
    ? { kind: "ready", record: { name: nameDecision.name } }
    : nameDecision;
}

export function evaluatePolicyTypeAddition(
  input: PolicyTypeAdditionInput,
): PolicyTypeAdditionDecision {
  const denied = evaluateVocabularyAccess(input.principal);
  if (denied !== null) {
    return denied;
  }

  const nameDecision = evaluateName(input.candidateName, input.existingNames);
  if (nameDecision.kind !== "ready") {
    return nameDecision;
  }
  if (
    input.classTag === undefined ||
    input.classTag === null ||
    input.classTag === ""
  ) {
    return { kind: "invalid", reason: "class_required" };
  }
  if (!isPolicyTypeClass(input.classTag)) {
    return { kind: "invalid", reason: "unknown_class" };
  }

  return {
    kind: "ready",
    record: { classTag: input.classTag, name: nameDecision.name },
  };
}

function evaluateVocabularyAccess(
  principal: AccessPrincipal | null,
): { kind: "denied"; reason: VocabularyDenialReason } | null {
  if (principal === null) {
    return { kind: "denied", reason: "unauthenticated" };
  }

  const decision = evaluateAccess(principal, VOCABULARY_ADD_ACCESS);
  return decision.allowed
    ? null
    : { kind: "denied", reason: decision.reason };
}

function evaluateName(
  candidateName: string,
  existingNames: readonly string[],
):
  | { kind: "invalid"; reason: "blank_name" }
  | { kind: "duplicate"; name: string }
  | { kind: "ready"; name: string } {
  const name = candidateName.trim();
  if (name.length === 0) {
    return { kind: "invalid", reason: "blank_name" };
  }

  const normalizedName = name.toLowerCase();
  if (
    existingNames.some(
      (existingName) => existingName.toLowerCase() === normalizedName,
    )
  ) {
    return { kind: "duplicate", name };
  }

  return { kind: "ready", name };
}
