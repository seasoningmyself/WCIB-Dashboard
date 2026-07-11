import { z } from "zod";
import { passwordSchema } from "./password-policy.js";
import { userEmailSchema } from "./user-credentials.js";

export const passwordResetRequestSchema = z
  .object({ email: userEmailSchema })
  .strict();

export const passwordResetTokenSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{43}$/, "Reset token is invalid");

export const passwordResetConfirmSchema = z
  .object({
    password: passwordSchema,
    token: passwordResetTokenSchema,
  })
  .strict();

export type PasswordResetRequest = z.output<
  typeof passwordResetRequestSchema
>;
export type PasswordResetConfirm = z.output<
  typeof passwordResetConfirmSchema
>;

export interface PasswordResetRequestResponse {
  status: "accepted";
}

export const passwordResetRequestResponseSchema = z
  .object({ status: z.literal("accepted") })
  .strict();
