import { z } from "zod";
import {
  adminLedgerPolicySchema,
  policyLedgerItemSchema,
  policyLedgerLabelsSchema,
} from "./policy-ledger.js";

export const MAX_POLICY_DELETE_REASON_LENGTH = 500;
export const MAX_DELETED_POLICY_ITEMS = 200;

const apiTimestampSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.string().datetime(),
);

export const policySoftDeleteRequestSchema = z
  .object({
    expectedUpdatedAt: apiTimestampSchema,
    reason: z.string().trim().min(1).max(MAX_POLICY_DELETE_REASON_LENGTH),
  })
  .strict();

export const policyRestoreRequestSchema = z
  .object({ expectedUpdatedAt: apiTimestampSchema })
  .strict();

export const policyDeletionMetadataSchema = z
  .object({
    deletedAt: apiTimestampSchema,
    deletedByUserId: z.string().uuid(),
    reason: z.string().min(1).max(MAX_POLICY_DELETE_REASON_LENGTH),
  })
  .strict();

export const deletedPolicyLedgerItemSchema = z
  .object({
    deletion: policyDeletionMetadataSchema,
    labels: policyLedgerLabelsSchema,
    policy: adminLedgerPolicySchema,
  })
  .strict();

export const deletedPolicyListResponseSchema = z
  .object({
    items: z.array(deletedPolicyLedgerItemSchema).max(MAX_DELETED_POLICY_ITEMS),
  })
  .strict();

export const policySoftDeleteResponseSchema = z
  .object({
    changed: z.boolean(),
    detachedOpenSheetCount: z.number().int().nonnegative(),
    item: deletedPolicyLedgerItemSchema,
  })
  .strict();

export const policyRestoreResponseSchema = z
  .object({
    changed: z.boolean(),
    item: policyLedgerItemSchema,
  })
  .strict();

export type PolicySoftDeleteRequest = z.output<
  typeof policySoftDeleteRequestSchema
>;
export type PolicyRestoreRequest = z.output<typeof policyRestoreRequestSchema>;
export type PolicyDeletionMetadata = z.output<
  typeof policyDeletionMetadataSchema
>;
export type DeletedPolicyLedgerItem = z.output<
  typeof deletedPolicyLedgerItemSchema
>;
export type DeletedPolicyListResponse = z.output<
  typeof deletedPolicyListResponseSchema
>;
export type PolicySoftDeleteResponse = z.output<
  typeof policySoftDeleteResponseSchema
>;
export type PolicyRestoreResponse = z.output<
  typeof policyRestoreResponseSchema
>;
