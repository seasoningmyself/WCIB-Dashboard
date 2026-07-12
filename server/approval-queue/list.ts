import { asc, eq, getTableColumns } from "drizzle-orm";
import {
  listApprovalWorkQuerySchema,
  type ListApprovalWorkQuery,
} from "../../shared/approval-queue.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import {
  approvalQueueEntries,
  drafts,
  staffProfiles,
  type ApprovalQueueEntryRecord,
  type DraftRecord,
} from "../db/schema.js";
import { requireApprovalAdmin } from "./access.js";

export const MAX_APPROVAL_WORK_ITEMS_PER_TYPE = 200;

export interface ApprovalSubmissionSource {
  entry: ApprovalQueueEntryRecord;
  submitterDisplayName: string | null;
}

export interface ApprovalHelpSource {
  draft: DraftRecord;
  submitterDisplayName: string | null;
}

export interface ApprovalWorkSource {
  helpRequests: readonly ApprovalHelpSource[];
  submissions: readonly ApprovalSubmissionSource[];
}

export async function listApprovalWork(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  rawQuery: unknown,
): Promise<ApprovalWorkSource> {
  requireApprovalAdmin(context);
  const query = listApprovalWorkQuerySchema.parse(rawQuery);

  const submissionsPromise =
    query.status === "flagged"
      ? Promise.resolve([] as ApprovalSubmissionSource[])
      : database
          .select({
            ...getTableColumns(approvalQueueEntries),
            submitterDisplayName: staffProfiles.displayName,
          })
          .from(approvalQueueEntries)
          .leftJoin(
            staffProfiles,
            eq(staffProfiles.userId, approvalQueueEntries.submittedByUserId),
          )
          .where(eq(approvalQueueEntries.status, "pending"))
          .orderBy(
            asc(approvalQueueEntries.submittedAt),
            asc(approvalQueueEntries.id),
          )
          .limit(MAX_APPROVAL_WORK_ITEMS_PER_TYPE)
          .then((rows) =>
            rows.map(({ submitterDisplayName, ...entry }) => ({
              entry,
              submitterDisplayName,
            })),
          );

  const helpRequestsPromise =
    query.status === "pending"
      ? Promise.resolve([] as ApprovalHelpSource[])
      : database
          .select({
            ...getTableColumns(drafts),
            submitterDisplayName: staffProfiles.displayName,
          })
          .from(drafts)
          .leftJoin(staffProfiles, eq(staffProfiles.userId, drafts.ownerUserId))
          .where(eq(drafts.status, "flagged"))
          .orderBy(asc(drafts.lastEditedAt), asc(drafts.id))
          .limit(MAX_APPROVAL_WORK_ITEMS_PER_TYPE)
          .then((rows) =>
            rows.map(({ submitterDisplayName, ...draft }) => ({
              draft,
              submitterDisplayName,
            })),
          );

  const [submissions, helpRequests] = await Promise.all([
    submissionsPromise,
    helpRequestsPromise,
  ]);
  return { helpRequests, submissions };
}

export type { ListApprovalWorkQuery };
