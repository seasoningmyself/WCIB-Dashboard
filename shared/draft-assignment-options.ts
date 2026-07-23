import { z } from "zod";

export const draftAssignmentOptionSchema = z
  .object({
    bookEnabled: z.boolean(),
    displayName: z.string().trim().min(1),
    firstYearEnabled: z.boolean(),
    userId: z.string().uuid(),
  })
  .strict();

export const draftAssignmentOptionsResponseSchema = z
  .object({
    producers: z.array(draftAssignmentOptionSchema),
  })
  .strict();

export type DraftAssignmentOption = z.output<
  typeof draftAssignmentOptionSchema
>;
export type DraftAssignmentOptionsResponse = z.output<
  typeof draftAssignmentOptionsResponseSchema
>;
