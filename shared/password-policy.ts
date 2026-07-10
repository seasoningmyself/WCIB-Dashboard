import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 12;

export const PASSWORD_REQUIREMENTS = [
  {
    id: "minLength",
    label: "At least 12 characters",
    message: "Password must be at least 12 characters",
    test: (password: string) => password.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: "uppercase",
    label: "At least one uppercase letter",
    message: "Password must contain at least one uppercase letter",
    test: (password: string) => /[A-Z]/.test(password),
  },
  {
    id: "lowercase",
    label: "At least one lowercase letter",
    message: "Password must contain at least one lowercase letter",
    test: (password: string) => /[a-z]/.test(password),
  },
  {
    id: "number",
    label: "At least one number",
    message: "Password must contain at least one number",
    test: (password: string) => /[0-9]/.test(password),
  },
  {
    id: "special",
    label: "At least one special character",
    message: "Password must contain at least one special character",
    test: (password: string) => /[^A-Za-z0-9]/.test(password),
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
  .superRefine(addPasswordRequirementIssues);

export const optionalPasswordSchema = z
  .string()
  .optional()
  .superRefine((password, context) => {
    if (!password) {
      return;
    }
    addPasswordRequirementIssues(password, context);
  });
