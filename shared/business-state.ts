import { z } from "zod";

export const BUSINESS_STATE_GENERATION_FORMAT_VERSION = 1;
export const BUSINESS_STATE_RESET_CONFIRMATION = "RESET";
export const BUSINESS_STATE_RESTORE_CONFIRMATION_PREFIX = "RESTORE ";
export const BUSINESS_STATE_GENERATION_STATUSES = ["active", "sealed"] as const;

export const businessStateGenerationStatusSchema = z.enum(
  BUSINESS_STATE_GENERATION_STATUSES,
);

export const resetBusinessStateRequestSchema = z
  .object({
    clearKpiTargets: z.boolean().default(false),
    confirmation: z.literal(BUSINESS_STATE_RESET_CONFIRMATION),
  })
  .strict();

export const restoreBusinessStateRequestSchema = z
  .object({
    confirmation: z.string().trim().min(1).max(100),
  })
  .strict();

export const businessStateGenerationParamsSchema = z
  .object({ generationId: z.string().uuid() })
  .strict();

export const businessStateRowCountsSchema = z
  .object({
    approvalQueueEntries: z.number().int().nonnegative(),
    drafts: z.number().int().nonnegative(),
    kpiTargets: z.number().int().nonnegative(),
    mgaPayments: z.number().int().nonnegative(),
    paySheetAdjustments: z.number().int().nonnegative(),
    paySheetPolicies: z.number().int().nonnegative(),
    paySheets: z.number().int().nonnegative(),
    policies: z.number().int().nonnegative(),
    policyChangeRequests: z.number().int().nonnegative(),
    policyOverrides: z.number().int().nonnegative(),
  })
  .strict();

export const businessStateGenerationSchema = z
  .object({
    baselineChecksum: z.string().regex(/^[0-9a-f]{32}$/).nullable(),
    clearKpiTargets: z.boolean(),
    code: z.string().regex(/^[A-Z0-9]{12}$/),
    createdAt: z.string().datetime({ offset: true }),
    id: z.string().uuid(),
    logicalChecksum: z.string().regex(/^[0-9a-f]{32}$/).nullable(),
    migrationCount: z.number().int().positive(),
    rowCounts: businessStateRowCountsSchema.nullable(),
    schemaFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    sealedAt: z.string().datetime({ offset: true }).nullable(),
    status: businessStateGenerationStatusSchema,
  })
  .strict();

export const businessStateListResponseSchema = z
  .object({
    activeGenerationId: z.string().uuid(),
    generations: z.array(businessStateGenerationSchema),
  })
  .strict();

export const businessStateTransitionResponseSchema = z
  .object({
    activeGeneration: businessStateGenerationSchema,
    sealedGeneration: businessStateGenerationSchema,
  })
  .strict();

export type BusinessStateGeneration = z.infer<
  typeof businessStateGenerationSchema
>;
export type BusinessStateListResponse = z.infer<
  typeof businessStateListResponseSchema
>;
export type BusinessStateTransitionResponse = z.infer<
  typeof businessStateTransitionResponseSchema
>;
export type ResetBusinessStateRequest = z.infer<
  typeof resetBusinessStateRequestSchema
>;
export type RestoreBusinessStateRequest = z.infer<
  typeof restoreBusinessStateRequestSchema
>;
