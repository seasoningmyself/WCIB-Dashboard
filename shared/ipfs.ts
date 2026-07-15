import { z } from "zod";

const apiTimestampSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.string().datetime(),
);

export const ipfsPriorFinancingQuerySchema = z
  .object({ insuredName: z.string().trim().min(1).max(300) })
  .strict();

export const ipfsPriorFinancingResponseSchema = z
  .object({
    priorFinancing: z
      .object({ lastFinancedAt: apiTimestampSchema })
      .strict()
      .nullable(),
  })
  .strict();

export type IpfsPriorFinancingQuery = z.output<
  typeof ipfsPriorFinancingQuerySchema
>;
export type IpfsPriorFinancingResponse = z.output<
  typeof ipfsPriorFinancingResponseSchema
>;
