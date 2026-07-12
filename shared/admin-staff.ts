import { z } from "zod";
import { STAFF_ROLES } from "./access.js";
import { passwordSchema } from "./password-policy.js";
import { userEmailSchema } from "./user-credentials.js";

export const STAFF_PRONOUNS = ["her", "his", "their"] as const;
export const ADMIN_STAFF_MAX_RESULTS = 500;

const uuidSchema = z.string().uuid();
const timestampSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.string().datetime(),
);
const displayNameSchema = z.string().trim().min(1).max(200);
const rateSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,2})\.[0-9]{2}$/)
  .refine((value) => Number(value) <= 100, "Rate must not exceed 100.00");

export const producerRateInputSchema = z
  .object({
    effectiveDate: z.string().date(),
    newBrokerRate: rateSchema,
    newCommissionRate: rateSchema,
    renewalBrokerRate: rateSchema,
    renewalCommissionRate: rateSchema,
  })
  .strict();

export const createAdminStaffRequestSchema = z
  .object({
    displayName: displayNameSchema,
    email: userEmailSchema,
    initialRate: producerRateInputSchema.optional(),
    pronoun: z.enum(STAFF_PRONOUNS),
    role: z.enum(STAFF_ROLES),
    temporaryPassword: passwordSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.role === "producer" && value.initialRate === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A new producer requires an initial rate",
        path: ["initialRate"],
      });
    }
    if (value.role === "employee" && value.initialRate !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Employee creation cannot add a producer rate",
        path: ["initialRate"],
      });
    }
  });

export const updateAdminStaffRequestSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    email: userEmailSchema.optional(),
    initialRate: producerRateInputSchema.optional(),
    pronoun: z.enum(STAFF_PRONOUNS).optional(),
    role: z.enum(STAFF_ROLES).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one staff field is required",
  });

export const adminStaffParamsSchema = z
  .object({ userId: uuidSchema })
  .strict();

export const adminStaffRateParamsSchema = z
  .object({ rateId: uuidSchema, userId: uuidSchema })
  .strict();

export const adminStaffRateSchema = producerRateInputSchema
  .extend({
    createdAt: timestampSchema,
    id: uuidSchema,
    lockedAt: timestampSchema.nullable(),
    updatedAt: timestampSchema,
  })
  .strict();

export const adminStaffRecordSchema = z
  .object({
    createdAt: timestampSchema,
    displayName: z.string().min(1),
    email: userEmailSchema,
    isActive: z.boolean(),
    pronoun: z.enum(STAFF_PRONOUNS),
    rateState: z.enum(["configured", "dormant", "missing", "not_applicable"]),
    rates: z.array(adminStaffRateSchema),
    role: z.enum(STAFF_ROLES),
    userId: uuidSchema,
  })
  .strict();

export const adminStaffListResponseSchema = z
  .object({ items: z.array(adminStaffRecordSchema) })
  .strict();

export const adminStaffMutationResponseSchema = z
  .object({ staff: adminStaffRecordSchema })
  .strict();

export type ProducerRateInput = z.output<typeof producerRateInputSchema>;
export type CreateAdminStaffRequest = z.output<
  typeof createAdminStaffRequestSchema
>;
export type UpdateAdminStaffRequest = z.output<
  typeof updateAdminStaffRequestSchema
>;
export type AdminStaffRate = z.output<typeof adminStaffRateSchema>;
export type AdminStaffRecord = z.output<typeof adminStaffRecordSchema>;
