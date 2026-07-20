import { z } from "zod";
import { isBlockedPassword } from "./password-blocklist.js";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_REQUIREMENTS = [
  {
    id: "minLength",
    label: "At least 12 characters",
    message: "Password must be at least 12 characters",
    test: (password: string) => passwordLength(password) >= PASSWORD_MIN_LENGTH,
  },
  {
    id: "maxLength",
    label: "No more than 128 characters",
    message: "Password must be 128 characters or fewer",
    test: (password: string) => passwordLength(password) <= PASSWORD_MAX_LENGTH,
  },
  {
    id: "blocklist",
    label: "Not common, compromised, or WCIB-predictable",
    message: "Password is too common or predictable",
    test: (password: string) => !isBlockedPassword(password),
  },
] as const;

export type PasswordRequirementId =
  (typeof PASSWORD_REQUIREMENTS)[number]["id"];

export interface PasswordRequirementStatus {
  id: PasswordRequirementId;
  isSatisfied: boolean;
  label: string;
  message: string;
}

export function getPasswordRequirementStatuses(
  password: string,
): PasswordRequirementStatus[] {
  return PASSWORD_REQUIREMENTS.map((requirement) => ({
    id: requirement.id,
    isSatisfied: requirement.test(password),
    label: requirement.label,
    message: requirement.message,
  }));
}

export function isPasswordPolicySatisfied(password: string): boolean {
  return PASSWORD_REQUIREMENTS.every((requirement) =>
    requirement.test(password),
  );
}

export function normalizePassword(password: string): string {
  return password.normalize("NFC");
}

function addPasswordRequirementIssues(
  password: string,
  context: z.RefinementCtx,
): void {
  for (const requirement of PASSWORD_REQUIREMENTS) {
    if (!requirement.test(password)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: requirement.message,
      });
    }
  }
}

export const passwordSchema = z
  .string()
  .superRefine(addPasswordRequirementIssues)
  .transform(normalizePassword);

export const optionalPasswordSchema = z
  .string()
  .optional()
  .superRefine((password, context) => {
    if (!password) {
      return;
    }
    addPasswordRequirementIssues(password, context);
  })
  .transform((password) =>
    password === undefined ? undefined : normalizePassword(password),
  );

function passwordLength(password: string): number {
  return Array.from(normalizePassword(password)).length;
}
