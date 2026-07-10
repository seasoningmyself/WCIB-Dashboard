import { z } from "zod";
import { passwordSchema } from "./password-policy.js";
import { userEmailSchema } from "./user-credentials.js";

export const passwordResetRequestSchema = z
  .object({ email: userEmailSchema })
  .strict();

export const passwordResetConfirmSchema = z
  .object({
    password: passwordSchema,
    token: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{43}$/, "Reset token is invalid"),
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
