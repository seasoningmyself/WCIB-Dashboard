import { z } from "zod";
import {
  normalizePassword,
  passwordSchema,
} from "./password-policy.js";

const uuidSchema = z.string().uuid();
const displayNameSchema = z.string().trim().min(1).max(200);
const currentPasswordSchema = z
  .string()
  .min(1, "Current password is required")
  .max(1_024, "Current password is too long");
const confirmationSchema = z
  .string()
  .max(512, "Password confirmation is too long")
  .transform(normalizePassword);

export const requiredPasswordChangeRequestSchema = z
  .object({
    confirmation: confirmationSchema,
    newPassword: passwordSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.newPassword !== value.confirmation) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Passwords do not match",
        path: ["confirmation"],
      });
    }
  });

export const updateOwnProfileRequestSchema = z
  .object({ displayName: displayNameSchema })
  .strict();

export const changeOwnPasswordRequestSchema = z
  .object({
    confirmation: confirmationSchema,
    currentPassword: currentPasswordSchema,
    newPassword: passwordSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.newPassword !== value.confirmation) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Passwords do not match",
        path: ["confirmation"],
      });
    }
  });

export const ownSettingsSchema = z
  .object({
    displayName: displayNameSchema,
    email: z.string().email(),
    officeLocation: z
      .object({
        id: uuidSchema,
        isActive: z.boolean(),
        name: z.string().trim().min(1).max(200),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const ownSettingsResponseSchema = z
  .object({ settings: ownSettingsSchema })
  .strict();

export type RequiredPasswordChangeRequest = z.output<
  typeof requiredPasswordChangeRequestSchema
>;
export type UpdateOwnProfileRequest = z.output<
  typeof updateOwnProfileRequestSchema
>;
export type ChangeOwnPasswordRequest = z.output<
  typeof changeOwnPasswordRequestSchema
>;
export type OwnSettings = z.output<typeof ownSettingsSchema>;
export type OwnSettingsResponse = z.output<typeof ownSettingsResponseSchema>;
