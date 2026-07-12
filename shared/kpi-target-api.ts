import { z } from "zod";
import { KPI_TARGET_SCOPE_TYPES } from "./kpi-targets.js";

export const KPI_TARGET_MAX_RESULTS = 500;
export const KPI_TARGET_MAX_COUNT = 2_147_483_647;

const uuidSchema = z.string().uuid();
const kpiTargetYearSchema = z.coerce.number().int().min(2000).max(9999);
const exactMoneySchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,11})\.[0-9]{2}$/);
const exactRateSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]?|100)\.[0-9]{2}$/)
  .refine((value) => Number(value) <= 100, "Rate must not exceed 100.00");

export const kpiTargetScopeTypeSchema = z.enum(KPI_TARGET_SCOPE_TYPES);

export const kpiTargetListQuerySchema = z
  .object({
    producerUserId: uuidSchema.optional(),
    scopeType: kpiTargetScopeTypeSchema.optional(),
    year: kpiTargetYearSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.scopeType === "company" && value.producerUserId !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Company scope cannot include a producer",
        path: ["producerUserId"],
      });
    }
    if (value.scopeType === "producer" && value.producerUserId === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Producer scope requires a producer UUID",
        path: ["producerUserId"],
      });
    }
    if (value.scopeType === undefined && value.producerUserId !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Producer UUID requires producer scope",
        path: ["scopeType"],
      });
    }
  });

export const kpiTargetParamsSchema = z
  .object({
    scopeType: kpiTargetScopeTypeSchema,
    year: kpiTargetYearSchema,
  })
  .strict();

export const kpiTargetMutationRequestSchema = z
  .object({
    newPolicyCountTarget: z
      .number()
      .int()
      .min(0)
      .max(KPI_TARGET_MAX_COUNT)
      .nullable()
      .optional(),
    newRevenueTarget: exactMoneySchema.nullable().optional(),
    producerUserId: uuidSchema.nullable(),
    retentionRateTarget: exactRateSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.newPolicyCountTarget !== undefined ||
      value.newRevenueTarget !== undefined ||
      value.retentionRateTarget !== undefined,
    { message: "At least one target value is required" },
  );

export const kpiTargetSchema = z
  .object({
    newPolicyCountTarget: z.number().int().min(0).nullable(),
    newRevenueTarget: exactMoneySchema.nullable(),
    producerUserId: uuidSchema.nullable(),
    retentionRateTarget: exactRateSchema.nullable(),
    scopeType: kpiTargetScopeTypeSchema,
    year: kpiTargetYearSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.scopeType === "company" && value.producerUserId !== null) ||
      (value.scopeType === "producer" && value.producerUserId === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "KPI target scope shape is invalid",
        path: ["producerUserId"],
      });
    }
  });

export const kpiTargetProducerSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200),
    isActive: z.boolean(),
    producerUserId: uuidSchema,
  })
  .strict();

export const kpiTargetListResponseSchema = z
  .object({
    items: z.array(kpiTargetSchema).max(KPI_TARGET_MAX_RESULTS),
    producers: z.array(kpiTargetProducerSchema).max(KPI_TARGET_MAX_RESULTS),
    year: kpiTargetYearSchema,
  })
  .strict();

export const kpiTargetMutationResponseSchema = z
  .object({ target: kpiTargetSchema })
  .strict();

export type KpiTarget = z.output<typeof kpiTargetSchema>;
export type KpiTargetListQuery = z.output<typeof kpiTargetListQuerySchema>;
export type KpiTargetListResponse = z.output<typeof kpiTargetListResponseSchema>;
export type KpiTargetMutationRequest = z.output<
  typeof kpiTargetMutationRequestSchema
>;
export type KpiTargetMutationResponse = z.output<
  typeof kpiTargetMutationResponseSchema
>;
export type KpiTargetProducer = z.output<typeof kpiTargetProducerSchema>;
