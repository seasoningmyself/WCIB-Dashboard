import { z } from "zod";
import { policyLedgerCorrectionRequestSchema } from "./policy-corrections.js";

export const POLICY_CHANGE_REQUEST_STATUSES = [
  "pending",
  "resolved",
  "rejected",
] as const;

export const POLICY_CHANGE_REQUEST_RESOLUTIONS = [
  "corrected",
  "as_is",
  "sent_back",
] as const;

export const POLICY_CHANGE_REQUEST_MUTATION_KINDS = [
  "general",
  "override",
] as const;

export const MAX_POLICY_CHANGE_REQUEST_REASON_LENGTH = 500;

const apiTimestampSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.string().datetime(),
);

export const policyChangeRequestParamsSchema = z
  .object({ requestId: z.string().uuid() })
  .strict();

export const policyChangeRequestPolicyParamsSchema = z
  .object({ policyId: z.string().uuid() })
  .strict();

export const createPolicyChangeRequestSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1)
      .max(MAX_POLICY_CHANGE_REQUEST_REASON_LENGTH),
  })
  .strict();

export const sendBackPolicyChangeRequestSchema = createPolicyChangeRequestSchema;
export const resolvePolicyChangeRequestAsIsSchema = z.object({}).strict();
export const correctPolicyChangeRequestSchema = policyLedgerCorrectionRequestSchema;

export const policyChangeRequestSchema = z
  .object({
    id: z.string().uuid(),
    mutationId: z.string().uuid().nullable(),
    mutationKind: z.enum(POLICY_CHANGE_REQUEST_MUTATION_KINDS).nullable(),
    policyId: z.string().uuid(),
    reason: z.string().min(1).max(MAX_POLICY_CHANGE_REQUEST_REASON_LENGTH),
    requestedAt: apiTimestampSchema,
    requestedByUserId: z.string().uuid(),
    resolution: z.enum(POLICY_CHANGE_REQUEST_RESOLUTIONS).nullable(),
    resolutionReason: z
      .string()
      .min(1)
      .max(MAX_POLICY_CHANGE_REQUEST_REASON_LENGTH)
      .nullable(),
    resolvedAt: apiTimestampSchema.nullable(),
    resolvedByUserId: z.string().uuid().nullable(),
    status: z.enum(POLICY_CHANGE_REQUEST_STATUSES),
  })
  .strict();

export const ownerPolicyChangeRequestSchema = policyChangeRequestSchema.omit({
  mutationId: true,
  mutationKind: true,
  requestedByUserId: true,
  resolvedByUserId: true,
});

export const adminPolicyChangeRequestSchema = z
  .object({
    insuredName: z.string(),
    policyNumber: z.string(),
    request: policyChangeRequestSchema,
    requesterDisplayName: z.string(),
  })
  .strict();

export const createPolicyChangeRequestResponseSchema = z
  .object({ request: ownerPolicyChangeRequestSchema })
  .strict();

export const listOwnPolicyChangeRequestsResponseSchema = z
  .object({ requests: z.array(ownerPolicyChangeRequestSchema) })
  .strict();

export const policyChangeRequestResolutionResponseSchema = z
  .object({ request: adminPolicyChangeRequestSchema })
  .strict();

export const policyChangeRequestCorrectionResponseSchema = z
  .object({
    policyId: z.string().uuid(),
    request: adminPolicyChangeRequestSchema,
  })
  .strict();

export type PolicyChangeRequestStatus =
  (typeof POLICY_CHANGE_REQUEST_STATUSES)[number];
export type PolicyChangeRequestResolution =
  (typeof POLICY_CHANGE_REQUEST_RESOLUTIONS)[number];
export type PolicyChangeRequestMutationKind =
  (typeof POLICY_CHANGE_REQUEST_MUTATION_KINDS)[number];
export type CreatePolicyChangeRequest = z.input<
  typeof createPolicyChangeRequestSchema
>;
export type CreatePolicyChangeRequestResponse = z.output<
  typeof createPolicyChangeRequestResponseSchema
>;
export type ListOwnPolicyChangeRequestsResponse = z.output<
  typeof listOwnPolicyChangeRequestsResponseSchema
>;
export type PolicyChangeRequest = z.output<typeof policyChangeRequestSchema>;
export type OwnerPolicyChangeRequest = z.output<
  typeof ownerPolicyChangeRequestSchema
>;
export type AdminPolicyChangeRequest = z.output<
  typeof adminPolicyChangeRequestSchema
>;
