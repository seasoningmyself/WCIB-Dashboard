import { z } from "zod";
import { ACTIVE_MFA_METHOD_TYPES } from "./mfa-scaffold.js";
import { STAFF_ROLES } from "./access.js";
import { userEmailSchema } from "./user-credentials.js";

export const adminAccountSecurityItemSchema = z
  .object({
    adminCapability: z.boolean(),
    displayName: z.string().min(1),
    email: z.string().email(),
    id: z.string().uuid(),
    isActive: z.boolean(),
    mfa: z
      .object({
        enrolled: z.boolean(),
        enrollmentRequired: z.boolean(),
        methods: z.array(z.enum(ACTIVE_MFA_METHOD_TYPES)),
        recoveryCodesRemaining: z.number().int().min(0).max(10),
      })
      .strict(),
    staffRole: z.enum(STAFF_ROLES).nullable(),
  })
  .strict();

export const adminAccountSecurityListResponseSchema = z
  .object({ items: z.array(adminAccountSecurityItemSchema) })
  .strict();

export const adminAccountSecurityParamsSchema = z
  .object({ userId: z.string().uuid() })
  .strict();

export const updateAdminCapabilityRequestSchema = z
  .object({ enabled: z.boolean() })
  .strict();

export const updateAdminAccountEmailRequestSchema = z
  .object({ email: userEmailSchema })
  .strict();

export const resetAdminMfaRequestSchema = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .strict();

export type AdminAccountSecurityItem = z.output<
  typeof adminAccountSecurityItemSchema
>;
export type AdminAccountSecurityListResponse = z.output<
  typeof adminAccountSecurityListResponseSchema
>;
