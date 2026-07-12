import { eq } from "drizzle-orm";
import {
  approvalSendBackRequestSchema,
  type ApprovalSendBackRequest,
} from "../../shared/approval-queue.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import {
  approvalQueueEntries,
  drafts,
  type ApprovalQueueEntryRecord,
  type DraftRecord,
} from "../db/schema.js";
import {
  sendBackFlaggedDraft,
  sendBackQueuedDraft,
} from "../policies/lifecycle.js";
import { requireApprovalAdmin } from "./access.js";
import {
  ApprovalItemNotFoundError,
  ApprovalItemStateError,
} from "./approve.js";

export async function sendBackPendingSubmission(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  queueEntryId: string,
  rawInput: unknown,
  actedAt = new Date(),
): Promise<ApprovalQueueEntryRecord> {
  requireApprovalAdmin(context);
  const input: ApprovalSendBackRequest =
    approvalSendBackRequestSchema.parse(rawInput);
  requireActionTimestamp(actedAt);

  return database.transaction(async (transaction) => {
    const [entry] = await transaction
      .select()
      .from(approvalQueueEntries)
      .where(eq(approvalQueueEntries.id, queueEntryId))
      .limit(1)
      .for("update");
    if (entry === undefined) {
      throw new ApprovalItemNotFoundError();
    }
    if (entry.status !== "pending" || actedAt < entry.submittedAt) {
      throw new ApprovalItemStateError();
    }

    await sendBackQueuedDraft(
      transaction,
      context,
      queueEntryId,
      input.reason,
      actedAt,
    );
    const [updated] = await transaction
      .select()
      .from(approvalQueueEntries)
      .where(eq(approvalQueueEntries.id, queueEntryId))
      .limit(1);
    if (updated === undefined || updated.status !== "sent_back") {
      throw new ApprovalItemStateError();
    }
    return updated;
  });
}

export async function sendBackFlaggedHelp(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  draftId: string,
  rawInput: unknown,
  actedAt = new Date(),
): Promise<DraftRecord> {
  requireApprovalAdmin(context);
  const input: ApprovalSendBackRequest =
    approvalSendBackRequestSchema.parse(rawInput);
  requireActionTimestamp(actedAt);

  return database.transaction(async (transaction) => {
    const [draft] = await transaction
      .select()
      .from(drafts)
      .where(eq(drafts.id, draftId))
      .limit(1)
      .for("update");
    if (draft === undefined) {
      throw new ApprovalItemNotFoundError();
    }
    if (draft.status !== "flagged" || actedAt < draft.lastEditedAt) {
      throw new ApprovalItemStateError();
    }

    await sendBackFlaggedDraft(
      transaction,
      context,
      draftId,
      input.reason,
      actedAt,
    );
    const [updated] = await transaction
      .select()
      .from(drafts)
      .where(eq(drafts.id, draftId))
      .limit(1);
    if (updated === undefined || updated.status !== "sent_back") {
      throw new ApprovalItemStateError();
    }
    return updated;
  });
}

function requireActionTimestamp(value: Date): void {
  if (Number.isNaN(value.getTime())) {
    throw new ApprovalItemStateError();
  }
}
