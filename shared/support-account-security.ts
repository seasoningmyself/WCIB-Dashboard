import { z } from "zod";

export const supportAccountSecurityItemSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200),
    email: z.string().email().max(320),
    id: z.string().uuid(),
    mfaEnrolled: z.boolean(),
    mfaEnrollmentRequired: z.boolean(),
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
