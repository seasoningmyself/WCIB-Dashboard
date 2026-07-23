import { z } from "zod";
import { ACTIVE_MFA_METHOD_TYPES } from "./mfa-scaffold.js";

const timestampSchema = z.string().datetime({ offset: true });

export const supportMfaMethodSchema = z
  .object({
    createdAt: timestampSchema,
    isPrimary: z.boolean(),
    label: z.string().trim().min(1).max(100),
    lastUsedAt: timestampSchema.nullable(),
    methodType: z.enum(ACTIVE_MFA_METHOD_TYPES),
  })
  .strict();

export const supportAccountSecurityItemSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200),
    email: z.string().email().max(320),
    id: z.string().uuid(),
    lastLoginAt: timestampSchema.nullable(),
    mfa: z
      .object({
        enrolled: z.boolean(),
        enrollmentRequired: z.boolean(),
        methods: z.array(supportMfaMethodSchema).max(100),
        recoveryCodesRemaining: z.number().int().min(0).max(10),
      })
      .strict(),
  })
  .strict();

export const supportAccountSecurityListResponseSchema = z
  .object({ items: z.array(supportAccountSecurityItemSchema) })
  .strict();

export type SupportAccountSecurityItem = z.output<
  typeof supportAccountSecurityItemSchema
>;
export type SupportAccountSecurityListResponse = z.output<
  typeof supportAccountSecurityListResponseSchema
>;
export type SupportMfaMethod = z.output<typeof supportMfaMethodSchema>;
