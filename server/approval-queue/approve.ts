import { and, eq, isNull } from "drizzle-orm";
import {
  createDraftRequestSchema,
  draftWritableInputFromSource,
  updateDraftRequestSchema,
} from "../../shared/drafts.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { inActiveBusinessGeneration } from "../db/business-state.js";
import {
  approvalQueueEntries,
  drafts,
  type DraftRecord,
  type PolicyRecord,
} from "../db/schema.js";
import {
  buildDraftContentValues,
  validateActiveDraftReferences,
} from "../drafts/create.js";
import { draftRecordToInput } from "../drafts/record.js";
import { buildDraftSubmissionSnapshot } from "../drafts/submit.js";
import {
  approveQueuedPolicyInTransaction,
  submitAdminPolicyDirectInTransaction,
} from "../policies/lifecycle.js";
import { requireApprovalAdmin } from "./access.js";
import { parseDraftSubmissionSnapshot } from "./snapshot.js";

export class ApprovalItemNotFoundError extends Error {
  constructor() {
    super("Approval item was not found");
    this.name = "ApprovalItemNotFoundError";
  }
}

export class ApprovalItemStateError extends Error {
  constructor() {
    super("Approval item is not actionable");
    this.name = "ApprovalItemStateError";
  }
}

export class ApprovalSnapshotError extends Error {
  constructor() {
    super("Submitted snapshot is invalid");
    this.name = "ApprovalSnapshotError";
  }
}

export async function approvePendingSubmission(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  queueEntryId: string,
  approvedAt = new Date(),
): Promise<PolicyRecord> {
  requireApprovalAdmin(context);
  requireApprovalTimestamp(approvedAt);

  return database.transaction(async (transaction) => {
    const [entry] = await transaction
      .select()
      .from(approvalQueueEntries)
      .where(
        and(
          eq(approvalQueueEntries.id, queueEntryId),
          isNull(approvalQueueEntries.deletedAt),
          inActiveBusinessGeneration(approvalQueueEntries.businessGenerationId),
        ),
      )
      .limit(1)
      .for("update");
    if (entry === undefined) {
      throw new ApprovalItemNotFoundError();
    }
    if (entry.status !== "pending") {
      throw new ApprovalItemStateError();
    }

    let input;
    try {
      input = parseDraftSubmissionSnapshot(entry.submittedPayload);
    } catch {
      throw new ApprovalSnapshotError();
    }
    return approveQueuedPolicyInTransaction(
      transaction,
      context,
      queueEntryId,
      input,
      approvedAt,
    );
  });
}

export async function approveCorrectedPendingSubmission(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  queueEntryId: string,
  rawPatch: unknown,
  approvedAt = new Date(),
): Promise<PolicyRecord> {
  const patch = updateDraftRequestSchema.parse(rawPatch);
  requireApprovalAdmin(context);
  requireApprovalTimestamp(approvedAt);

  return database.transaction(async (transaction) => {
    const [entry] = await transaction
      .select()
      .from(approvalQueueEntries)
      .where(
        and(
          eq(approvalQueueEntries.id, queueEntryId),
          isNull(approvalQueueEntries.deletedAt),
          inActiveBusinessGeneration(approvalQueueEntries.businessGenerationId),
        ),
      )
      .limit(1)
      .for("update");
    if (entry === undefined) {
      throw new ApprovalItemNotFoundError();
    }
    if (entry.status !== "pending" || approvedAt < entry.submittedAt) {
      throw new ApprovalItemStateError();
    }

    const [record] = await transaction
      .select()
      .from(drafts)
      .where(
        and(
          eq(drafts.id, entry.draftId),
          isNull(drafts.deletedAt),
          inActiveBusinessGeneration(drafts.businessGenerationId),
        ),
      )
      .limit(1)
      .for("update");
    if (record === undefined) {
      throw new ApprovalItemNotFoundError();
    }
    if (
      record.status !== "submitted" ||
      record.linkedQueueEntryId !== queueEntryId
    ) {
      throw new ApprovalItemStateError();
    }

    let sourceInput;
    try {
      sourceInput = draftWritableInputFromSource(
        parseDraftSubmissionSnapshot(entry.submittedPayload),
      );
    } catch {
      throw new ApprovalSnapshotError();
    }
    const input = createDraftRequestSchema.parse({ ...sourceInput, ...patch });
    await validateActiveDraftReferences(transaction, input);
    const correctedSource: DraftRecord = {
      ...record,
      ...buildDraftContentValues(input),
    };
    const correctedSnapshot = buildDraftSubmissionSnapshot(
      correctedSource,
      input,
    );
    return approveQueuedPolicyInTransaction(
      transaction,
      context,
      queueEntryId,
      correctedSnapshot,
      approvedAt,
    );
  });
}

export async function pushThroughFlaggedHelp(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  draftId: string,
  approvedAt = new Date(),
): Promise<PolicyRecord> {
  return approveFlaggedHelp(database, context, draftId, null, approvedAt);
}

export async function approveCorrectedFlaggedHelp(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  draftId: string,
  rawPatch: unknown,
  approvedAt = new Date(),
): Promise<PolicyRecord> {
  const patch = updateDraftRequestSchema.parse(rawPatch);
  return approveFlaggedHelp(database, context, draftId, patch, approvedAt);
}

async function approveFlaggedHelp(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  draftId: string,
  patch: Record<string, unknown> | null,
  approvedAt: Date,
): Promise<PolicyRecord> {
  requireApprovalAdmin(context);
  requireApprovalTimestamp(approvedAt);

  return database.transaction(async (transaction) => {
    const [record] = await transaction
      .select()
      .from(drafts)
      .where(
        and(
          eq(drafts.id, draftId),
          isNull(drafts.deletedAt),
          inActiveBusinessGeneration(drafts.businessGenerationId),
        ),
      )
      .limit(1)
      .for("update");
    if (record === undefined) {
      throw new ApprovalItemNotFoundError();
    }
    if (record.status !== "flagged" || approvedAt < record.lastEditedAt) {
      throw new ApprovalItemStateError();
    }

    const input = createDraftRequestSchema.parse({
      ...draftRecordToInput(record),
      ...(patch ?? {}),
    });
    await validateActiveDraftReferences(transaction, input);
    const snapshotSource: DraftRecord = {
      ...record,
      ...buildDraftContentValues(input),
    };
    const snapshot = buildDraftSubmissionSnapshot(snapshotSource, input);
    return submitAdminPolicyDirectInTransaction(
      transaction,
      context,
      { ...snapshot },
      record.id,
      approvedAt,
    );
  });
}

function requireApprovalTimestamp(value: Date): void {
  if (Number.isNaN(value.getTime())) {
    throw new ApprovalItemStateError();
  }
}
