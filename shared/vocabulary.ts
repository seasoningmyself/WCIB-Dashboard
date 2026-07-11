import { z } from "zod";
import { POLICY_TYPE_CLASSES } from "./policy-types.js";

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
    officeLocations: z.array(vocabularyOptionSchema),
    policyTypes: z.array(policyTypeOptionSchema),
  })
  .strict();

export type VocabularyOption = z.output<typeof vocabularyOptionSchema>;
export type PolicyTypeOption = z.output<typeof policyTypeOptionSchema>;
export type ActiveVocabularyResponse = z.output<
  typeof activeVocabularyResponseSchema
>;
