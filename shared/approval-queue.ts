import { z } from "zod";
import { draftResponseSchema, flagDraftRequestSchema } from "./drafts.js";

export const APPROVAL_WORK_STATUSES = ["all", "pending", "flagged"] as const;

export const listApprovalWorkQuerySchema = z
  .object({
    status: z.enum(APPROVAL_WORK_STATUSES).default("all"),
  })
  .strict();

const apiTimestampSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.string().datetime(),
);

export const adminApprovalQueueEntrySchema = z
  .object({
    actedAt: apiTimestampSchema.nullable(),
    actedByUserId: z.string().uuid().nullable(),
    createdAt: apiTimestampSchema,
    draftId: z.string().uuid(),
    id: z.string().uuid(),
    reason: z.string().nullable(),
    status: z.enum(["pending", "approved", "sent_back", "flagged"]),
    submittedAt: apiTimestampSchema,
    submittedByUserId: z.string().uuid(),
    submittedPayload: z.record(z.string(), z.unknown()),
    updatedAt: apiTimestampSchema,
  })
  .strict();

const submitterDisplayNameSchema = z.string().trim().min(1).nullable();

export const approvalWorkListResponseSchema = z
  .object({
    helpRequests: z.array(
      z
        .object({
          draft: draftResponseSchema,
          submitterDisplayName: submitterDisplayNameSchema,
        })
        .strict(),
    ),
    submissions: z.array(
      z
        .object({
          entry: adminApprovalQueueEntrySchema,
          submitterDisplayName: submitterDisplayNameSchema,
        })
        .strict(),
    ),
  })
  .strict();

export const approvalSendBackRequestSchema = flagDraftRequestSchema;

export const approvalQueueSendBackResponseSchema = z
  .object({ entry: adminApprovalQueueEntrySchema })
  .strict();

export const flaggedHelpSendBackResponseSchema = z
  .object({ draft: draftResponseSchema })
  .strict();

export type ListApprovalWorkQuery = z.output<
  typeof listApprovalWorkQuerySchema
>;
export type ApprovalWorkListResponse = z.output<
  typeof approvalWorkListResponseSchema
>;
export type ApprovalSendBackRequest = z.output<
  typeof approvalSendBackRequestSchema
>;
