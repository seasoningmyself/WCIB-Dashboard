import { z } from "zod";
import { adminApprovalQueueEntrySchema } from "./approval-queue.js";
import { draftResponseSchema } from "./drafts.js";

export const APPROVAL_WORK_DELETION_KINDS = ["submission", "help"] as const;
export const MAX_APPROVAL_WORK_DELETE_REASON_LENGTH = 500;
export const MAX_DELETED_APPROVAL_WORK_ITEMS = 200;

const apiTimestampSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.string().datetime(),
);

const submitterDisplayNameSchema = z.string().trim().min(1).nullable();

export const approvalWorkDeletionParamsSchema = z
  .object({ id: z.string().uuid() })
  .strict();

export const approvalWorkSoftDeleteRequestSchema = z
  .object({
    expectedUpdatedAt: apiTimestampSchema,
    reason: z
      .string()
      .trim()
      .min(1)
      .max(MAX_APPROVAL_WORK_DELETE_REASON_LENGTH),
  })
  .strict();

export const approvalWorkRestoreRequestSchema = z
  .object({ expectedUpdatedAt: apiTimestampSchema })
  .strict();

export const approvalWorkDeletionMetadataSchema = z
  .object({
    deletedAt: apiTimestampSchema,
    deletedByUserId: z.string().uuid(),
    reason: z
      .string()
      .min(1)
      .max(MAX_APPROVAL_WORK_DELETE_REASON_LENGTH),
  })
  .strict();

const activeSubmissionSchema = z
  .object({
    entry: adminApprovalQueueEntrySchema,
    kind: z.literal("submission"),
    submitterDisplayName: submitterDisplayNameSchema,
  })
  .strict();

const activeHelpSchema = z
  .object({
    draft: draftResponseSchema,
    kind: z.literal("help"),
    submitterDisplayName: submitterDisplayNameSchema,
  })
  .strict();

export const activeApprovalWorkItemSchema = z.discriminatedUnion("kind", [
  activeSubmissionSchema,
  activeHelpSchema,
]);

export const deletedApprovalWorkItemSchema = z.discriminatedUnion("kind", [
  activeSubmissionSchema.extend({
    deletion: approvalWorkDeletionMetadataSchema,
  }),
  activeHelpSchema.extend({ deletion: approvalWorkDeletionMetadataSchema }),
]);

export const deletedApprovalWorkListResponseSchema = z
  .object({
    items: z
      .array(deletedApprovalWorkItemSchema)
      .max(MAX_DELETED_APPROVAL_WORK_ITEMS),
  })
  .strict();

export const approvalWorkSoftDeleteResponseSchema = z
  .object({ changed: z.boolean(), item: deletedApprovalWorkItemSchema })
  .strict();

export const approvalWorkRestoreResponseSchema = z
  .object({ changed: z.boolean(), item: activeApprovalWorkItemSchema })
  .strict();

export type ApprovalWorkDeletionKind =
  (typeof APPROVAL_WORK_DELETION_KINDS)[number];
export type ApprovalWorkSoftDeleteRequest = z.output<
  typeof approvalWorkSoftDeleteRequestSchema
>;
export type ApprovalWorkRestoreRequest = z.output<
  typeof approvalWorkRestoreRequestSchema
>;
export type ApprovalWorkDeletionMetadata = z.output<
  typeof approvalWorkDeletionMetadataSchema
>;
export type ActiveApprovalWorkItem = z.output<
  typeof activeApprovalWorkItemSchema
>;
export type DeletedApprovalWorkItem = z.output<
  typeof deletedApprovalWorkItemSchema
>;
export type DeletedApprovalWorkListResponse = z.output<
  typeof deletedApprovalWorkListResponseSchema
>;
export type ApprovalWorkSoftDeleteResponse = z.output<
  typeof approvalWorkSoftDeleteResponseSchema
>;
export type ApprovalWorkRestoreResponse = z.output<
  typeof approvalWorkRestoreResponseSchema
>;
