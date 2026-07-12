import { z } from "zod";
import { POLICY_TYPE_CLASSES } from "./policy-types.js";
import {
  officeSelectionModeMatches,
  officeSelectionModeSchema,
} from "./office-selection.js";

export const VOCABULARY_NAME_MAX_LENGTH = 200;

const vocabularyNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(VOCABULARY_NAME_MAX_LENGTH);

export const vocabularyOptionSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
  })
  .strict();

export const policyTypeOptionSchema = vocabularyOptionSchema
  .extend({
    classTag: z.enum(POLICY_TYPE_CLASSES),
  })
  .strict();

export const activeVocabularyResponseSchema = z
  .object({
    carriers: z.array(vocabularyOptionSchema),
    mgas: z.array(vocabularyOptionSchema),
    officeMode: officeSelectionModeSchema,
    officeLocations: z.array(vocabularyOptionSchema),
    policyTypes: z.array(policyTypeOptionSchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (!officeSelectionModeMatches(value.officeMode, value.officeLocations)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Office mode must match the active office list",
        path: ["officeMode"],
      });
    }
  });

export const createCarrierRequestSchema = z
  .object({
    name: vocabularyNameSchema,
  })
  .strict();

export const createPolicyTypeRequestSchema = z
  .object({
    classTag: z.enum(POLICY_TYPE_CLASSES),
    name: vocabularyNameSchema,
  })
  .strict();

export const createMgaRequestSchema = z
  .object({
    confirmNearDuplicate: z.boolean().optional().default(false),
    name: vocabularyNameSchema,
  })
  .strict();

export const vocabularyMutationOutcomeSchema = z.enum([
  "created",
  "duplicate",
]);

export const carrierMutationResponseSchema = z
  .object({
    item: vocabularyOptionSchema,
    outcome: vocabularyMutationOutcomeSchema,
  })
  .strict();

export const policyTypeMutationResponseSchema = z
  .object({
    item: policyTypeOptionSchema,
    outcome: vocabularyMutationOutcomeSchema,
  })
  .strict();

export const mgaMutationResponseSchema = z.union([
  z
    .object({
      item: vocabularyOptionSchema,
      outcome: z.literal("created"),
    })
    .strict(),
  z
    .object({
      item: vocabularyOptionSchema,
      outcome: z.literal("duplicate"),
    })
    .strict(),
  z
    .object({
      candidates: z.array(vocabularyOptionSchema).min(1),
      outcome: z.literal("confirmation_required"),
    })
    .strict(),
]);

export type VocabularyOption = z.output<typeof vocabularyOptionSchema>;
export type PolicyTypeOption = z.output<typeof policyTypeOptionSchema>;
export type ActiveVocabularyResponse = z.output<
  typeof activeVocabularyResponseSchema
>;
export type CreateCarrierRequest = z.output<typeof createCarrierRequestSchema>;
export type CreatePolicyTypeRequest = z.output<
  typeof createPolicyTypeRequestSchema
>;
export type CreateMgaRequest = z.output<typeof createMgaRequestSchema>;
export type CarrierMutationResponse = z.output<
  typeof carrierMutationResponseSchema
>;
export type PolicyTypeMutationResponse = z.output<
  typeof policyTypeMutationResponseSchema
>;
export type MgaMutationResponse = z.output<typeof mgaMutationResponseSchema>;
