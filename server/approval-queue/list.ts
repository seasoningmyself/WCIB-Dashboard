import { and, asc, eq, getTableColumns, isNull } from "drizzle-orm";
import {
  listApprovalWorkQuerySchema,
  type ListApprovalWorkQuery,
} from "../../shared/approval-queue.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { inActiveBusinessGeneration } from "../db/business-state.js";
import {
  approvalQueueEntries,
  drafts,
  staffProfiles,
  type ApprovalQueueEntryRecord,
  type DraftRecord,
} from "../db/schema.js";
import { requireApprovalAdmin } from "./access.js";
import {
  listPendingPolicyChangeRequests,
} from "../policy-change-requests/service.js";
import type { AdminPolicyChangeRequestSource } from "../policy-change-requests/projection.js";

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
  changeRequests: readonly AdminPolicyChangeRequestSource[];
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
          .where(
            and(
              eq(approvalQueueEntries.status, "pending"),
              isNull(approvalQueueEntries.deletedAt),
              inActiveBusinessGeneration(
                approvalQueueEntries.businessGenerationId,
              ),
            ),
          )
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
          .where(
            and(
              eq(drafts.status, "flagged"),
              isNull(drafts.deletedAt),
              inActiveBusinessGeneration(drafts.businessGenerationId),
            ),
          )
          .orderBy(asc(drafts.lastEditedAt), asc(drafts.id))
          .limit(MAX_APPROVAL_WORK_ITEMS_PER_TYPE)
          .then((rows) =>
            rows.map(({ submitterDisplayName, ...draft }) => ({
              draft,
              submitterDisplayName,
            })),
          );

  const changeRequestsPromise =
    query.status === "pending"
      ? Promise.resolve([] as AdminPolicyChangeRequestSource[])
      : listPendingPolicyChangeRequests(database, context);

  const [submissions, helpRequests, changeRequests] = await Promise.all([
    submissionsPromise,
    helpRequestsPromise,
    changeRequestsPromise,
  ]);
  return { changeRequests, helpRequests, submissions };
}

export type { ListApprovalWorkQuery };
