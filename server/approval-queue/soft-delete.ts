import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import {
  MAX_DELETED_APPROVAL_WORK_ITEMS,
  approvalWorkRestoreRequestSchema,
  approvalWorkSoftDeleteRequestSchema,
  type ApprovalWorkDeletionKind,
  type ApprovalWorkSoftDeleteKind,
} from "../../shared/approval-work-deletions.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { inActiveBusinessGeneration } from "../db/business-state.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import {
  approvalQueueEntries,
  drafts,
  users,
  type ApprovalQueueEntryRecord,
  type DraftRecord,
} from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import { requireApprovalAdmin } from "./access.js";

const databaseMutationResultSchema = z
  .object({
    changed: z.boolean(),
    draftId: z.string().uuid(),
    kind: z.enum(["submission", "help", "draft"]),
    targetId: z.string().uuid(),
  })
  .strict();

interface SubmissionDeletionSource {
  entry: ApprovalQueueEntryRecord;
  kind: "submission";
  submitterDisplayName: string | null;
}

interface HelpDeletionSource {
  draft: DraftRecord;
  kind: "help";
  submitterDisplayName: string | null;
}

interface DraftDeletionSource {
  draft: DraftRecord;
  kind: "draft";
  submitterDisplayName: string | null;
}

export type ApprovalWorkDeletionSource =
  | SubmissionDeletionSource
  | HelpDeletionSource
  | DraftDeletionSource;

export interface ApprovalWorkDeletionResult {
  changed: boolean;
  source: ApprovalWorkDeletionSource;
}

export class ApprovalWorkDeletionNotFoundError extends Error {
  constructor() {
    super("Approval work was not found");
    this.name = "ApprovalWorkDeletionNotFoundError";
  }
}

export class ApprovalWorkDeletionStaleError extends Error {
  constructor() {
    super("Approval work version is stale");
    this.name = "ApprovalWorkDeletionStaleError";
  }
}

export class ApprovalWorkDeletionStateError extends Error {
  constructor() {
    super("Approval work cannot be deleted or restored in its current state");
    this.name = "ApprovalWorkDeletionStateError";
  }
}

export async function listDeletedApprovalWork(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
): Promise<readonly ApprovalWorkDeletionSource[]> {
  requireApprovalAdmin(context);
  const [submissions, helpRequests, discardedDrafts] = await Promise.all([
    database
      .select({
        ...getTableColumns(approvalQueueEntries),
        submitterDisplayName: users.displayName,
      })
      .from(approvalQueueEntries)
      .leftJoin(
        users,
        eq(users.id, approvalQueueEntries.submittedByUserId),
      )
      .where(
        and(
          isNotNull(approvalQueueEntries.deletedAt),
          inArray(approvalQueueEntries.status, ["pending", "flagged"]),
          inActiveBusinessGeneration(
            approvalQueueEntries.businessGenerationId,
          ),
        ),
      )
      .orderBy(
        desc(approvalQueueEntries.deletedAt),
        asc(approvalQueueEntries.id),
      )
      .limit(MAX_DELETED_APPROVAL_WORK_ITEMS),
    database
      .select({
        ...getTableColumns(drafts),
        submitterDisplayName: users.displayName,
      })
      .from(drafts)
      .leftJoin(users, eq(users.id, drafts.ownerUserId))
      .where(
        and(
          eq(drafts.status, "flagged"),
          isNull(drafts.linkedQueueEntryId),
          isNotNull(drafts.deletedAt),
          inActiveBusinessGeneration(drafts.businessGenerationId),
        ),
      )
      .orderBy(desc(drafts.deletedAt), asc(drafts.id))
      .limit(MAX_DELETED_APPROVAL_WORK_ITEMS),
    database
      .select({
        ...getTableColumns(drafts),
        submitterDisplayName: users.displayName,
      })
      .from(drafts)
      .leftJoin(users, eq(users.id, drafts.ownerUserId))
      .where(
        and(
          eq(drafts.status, "draft"),
          isNull(drafts.linkedQueueEntryId),
          isNotNull(drafts.deletedAt),
          inActiveBusinessGeneration(drafts.businessGenerationId),
        ),
      )
      .orderBy(desc(drafts.deletedAt), asc(drafts.id))
      .limit(MAX_DELETED_APPROVAL_WORK_ITEMS),
  ]);

  return [
    ...submissions.map(({ submitterDisplayName, ...entry }) => ({
      entry,
      kind: "submission" as const,
      submitterDisplayName,
    })),
    ...helpRequests.map(({ submitterDisplayName, ...draft }) => ({
      draft,
      kind: "help" as const,
      submitterDisplayName,
    })),
    ...discardedDrafts.map(({ submitterDisplayName, ...draft }) => ({
      draft,
      kind: "draft" as const,
      submitterDisplayName,
    })),
  ]
    .sort((left, right) => {
      const byDeletedAt =
        deletionTimestamp(right).getTime() - deletionTimestamp(left).getTime();
      return byDeletedAt === 0
        ? sourceId(left).localeCompare(sourceId(right))
        : byDeletedAt;
    })
    .slice(0, MAX_DELETED_APPROVAL_WORK_ITEMS);
}

export async function softDeleteApprovalWork(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  kind: ApprovalWorkSoftDeleteKind,
  targetId: string,
  rawInput: unknown,
  logger: AppLogger,
  changedAt = new Date(),
): Promise<ApprovalWorkDeletionResult> {
  const actorUserId = requireApprovalAdmin(context);
  const input = approvalWorkSoftDeleteRequestSchema.parse(rawInput);
  requireTimestamp(changedAt);
  try {
    const mutation = await executeMutation(database, sql`
      select soft_delete_approval_work(
        ${kind}::text,
        ${targetId}::uuid,
        ${actorUserId}::uuid,
        ${input.reason}::text,
        ${input.expectedUpdatedAt}::timestamp with time zone,
        ${changedAt}::timestamp with time zone
      ) as mutation
    `);
    validateMutationIdentity(mutation, kind, targetId);
    const source = await getApprovalWorkDeletionSource(
      database,
      kind,
      targetId,
      true,
    );
    logger.info("Approval work moved to deleted records", {
      actorUserId,
      changed: mutation.changed,
      component: "approval_work_deletion",
      event: "approval_work_soft_delete_succeeded",
      kind,
      targetId,
    });
    return { changed: mutation.changed, source };
  } catch (error) {
    logger.error(
      "Approval-work soft-delete failed",
      {
        actorUserId,
        component: "approval_work_deletion",
        event: "approval_work_soft_delete_failed",
        kind,
        targetId,
      },
      error,
    );
    throw mapApprovalWorkDeletionDatabaseError(error);
  }
}

export async function restoreApprovalWork(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  kind: ApprovalWorkDeletionKind,
  targetId: string,
  rawInput: unknown,
  logger: AppLogger,
  changedAt = new Date(),
): Promise<ApprovalWorkDeletionResult> {
  const actorUserId = requireApprovalAdmin(context);
  const input = approvalWorkRestoreRequestSchema.parse(rawInput);
  requireTimestamp(changedAt);
  try {
    const mutation = await executeMutation(
      database,
      kind === "draft"
        ? sql`
            select restore_discarded_draft(
              ${targetId}::uuid,
              ${actorUserId}::uuid,
              ${input.expectedUpdatedAt}::timestamp with time zone,
              ${changedAt}::timestamp with time zone
            ) as mutation
          `
        : sql`
            select restore_approval_work(
              ${kind}::text,
              ${targetId}::uuid,
              ${actorUserId}::uuid,
              ${input.expectedUpdatedAt}::timestamp with time zone,
              ${changedAt}::timestamp with time zone
            ) as mutation
          `,
    );
    validateMutationIdentity(mutation, kind, targetId);
    const source = await getApprovalWorkDeletionSource(
      database,
      kind,
      targetId,
      false,
    );
    logger.info("Approval work restored to active records", {
      actorUserId,
      changed: mutation.changed,
      component: "approval_work_deletion",
      event: "approval_work_restore_succeeded",
      kind,
      targetId,
    });
    return { changed: mutation.changed, source };
  } catch (error) {
    logger.error(
      "Approval-work restore failed",
      {
        actorUserId,
        component: "approval_work_deletion",
        event: "approval_work_restore_failed",
        kind,
        targetId,
      },
      error,
    );
    throw mapApprovalWorkDeletionDatabaseError(error);
  }
}

async function executeMutation(
  database: AuthDatabase,
  query: ReturnType<typeof sql>,
) {
  const result = await database.execute<{ mutation: unknown }>(query);
  return databaseMutationResultSchema.parse(result.rows[0]?.mutation);
}

async function getApprovalWorkDeletionSource(
  database: AuthDatabase,
  kind: ApprovalWorkDeletionKind,
  targetId: string,
  deleted: boolean,
): Promise<ApprovalWorkDeletionSource> {
  if (kind === "submission") {
    const [row] = await database
      .select({
        ...getTableColumns(approvalQueueEntries),
        submitterDisplayName: users.displayName,
      })
      .from(approvalQueueEntries)
      .leftJoin(
        users,
        eq(users.id, approvalQueueEntries.submittedByUserId),
      )
      .where(
        and(
          eq(approvalQueueEntries.id, targetId),
          deleted
            ? isNotNull(approvalQueueEntries.deletedAt)
            : isNull(approvalQueueEntries.deletedAt),
          inActiveBusinessGeneration(
            approvalQueueEntries.businessGenerationId,
          ),
        ),
      )
      .limit(1);
    if (row === undefined) throw new ApprovalWorkDeletionNotFoundError();
    const { submitterDisplayName, ...entry } = row;
    return { entry, kind, submitterDisplayName };
  }

  const [row] = await database
    .select({
      ...getTableColumns(drafts),
      submitterDisplayName: users.displayName,
    })
    .from(drafts)
    .leftJoin(users, eq(users.id, drafts.ownerUserId))
    .where(
      and(
        eq(drafts.id, targetId),
        eq(drafts.status, kind === "help" ? "flagged" : "draft"),
        isNull(drafts.linkedQueueEntryId),
        deleted ? isNotNull(drafts.deletedAt) : isNull(drafts.deletedAt),
        inActiveBusinessGeneration(drafts.businessGenerationId),
      ),
    )
    .limit(1);
  if (row === undefined) throw new ApprovalWorkDeletionNotFoundError();
  const { submitterDisplayName, ...draft } = row;
  return { draft, kind, submitterDisplayName };
}

function validateMutationIdentity(
  mutation: z.output<typeof databaseMutationResultSchema>,
  kind: ApprovalWorkDeletionKind,
  targetId: string,
): void {
  if (mutation.kind !== kind || mutation.targetId !== targetId) {
    throw new ApprovalWorkDeletionStateError();
  }
}

function deletionTimestamp(source: ApprovalWorkDeletionSource): Date {
  const deletedAt =
    source.kind === "submission"
      ? source.entry.deletedAt
      : source.draft.deletedAt;
  if (deletedAt === null) throw new ApprovalWorkDeletionStateError();
  return deletedAt;
}

function sourceId(source: ApprovalWorkDeletionSource): string {
  return source.kind === "submission" ? source.entry.id : source.draft.id;
}

function mapApprovalWorkDeletionDatabaseError(error: unknown): unknown {
  if (
    error instanceof ApprovalWorkDeletionNotFoundError ||
    error instanceof ApprovalWorkDeletionStaleError ||
    error instanceof ApprovalWorkDeletionStateError
  ) {
    return error;
  }
  const code = readDatabaseErrorCode(error);
  if (code === "P0002") return new ApprovalWorkDeletionNotFoundError();
  if (code === "40001") return new ApprovalWorkDeletionStaleError();
  if (
    code === "22004" ||
    code === "22P02" ||
    code === "23503" ||
    code === "23514" ||
    code === "42501" ||
    code === "55000"
  ) {
    return new ApprovalWorkDeletionStateError();
  }
  return error;
}

function requireTimestamp(value: Date): void {
  if (Number.isNaN(value.getTime())) {
    throw new ApprovalWorkDeletionStateError();
  }
}
