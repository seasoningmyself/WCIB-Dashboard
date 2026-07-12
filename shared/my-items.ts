import { z } from "zod";
import { DRAFT_STATUSES } from "./policy-fields.js";

const apiTimestampSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.string().datetime(),
);

export const MY_ITEM_STATUSES = DRAFT_STATUSES;

export const myItemSchema = z
  .object({
    id: z.string().uuid(),
    lastActivityAt: apiTimestampSchema,
    reason: z.string().max(500).nullable(),
    status: z.enum(MY_ITEM_STATUSES),
    submittedAt: apiTimestampSchema.nullable(),
    title: z.string().min(1).max(300),
  })
  .strict();

export const myItemsResponseSchema = z
  .object({ items: z.array(myItemSchema) })
  .strict();

export type MyItem = z.output<typeof myItemSchema>;
export type MyItemsResponse = z.output<typeof myItemsResponseSchema>;
