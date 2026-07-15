import { z } from "zod";
import { policyLedgerItemSchema } from "./policy-ledger.js";

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

export const ipfsPushedStateRequestSchema = z
  .object({
    expectedUpdatedAt: apiTimestampSchema,
    pushed: z.boolean(),
  })
  .strict();

export const ipfsPushedStateResponseSchema = z
  .object({
    changed: z.boolean(),
    item: policyLedgerItemSchema,
  })
  .strict();

export type IpfsPriorFinancingQuery = z.output<
  typeof ipfsPriorFinancingQuerySchema
>;
export type IpfsPriorFinancingResponse = z.output<
  typeof ipfsPriorFinancingResponseSchema
>;
export type IpfsPushedStateRequest = z.output<
  typeof ipfsPushedStateRequestSchema
>;
export type IpfsPushedStateResponse = z.output<
  typeof ipfsPushedStateResponseSchema
>;
