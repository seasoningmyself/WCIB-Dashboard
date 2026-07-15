import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { projectDraftForAuthorizedContext } from "../drafts/projection.js";
import { projectAdminApprovalQueueEntry } from "./projection.js";
import type { ApprovalWorkDeletionSource } from "./soft-delete.js";

export function projectAdminActiveApprovalWork(
  source: Readonly<ApprovalWorkDeletionSource>,
  context: AuthorizedRequestContext,
): object | null {
  if (source.kind === "submission") {
    const entry = projectAdminApprovalQueueEntry(source.entry, context);
    return entry === null
      ? null
      : {
          entry,
          kind: source.kind,
          submitterDisplayName: source.submitterDisplayName,
        };
  }
  const draft = projectDraftForAuthorizedContext(source.draft, context);
  return draft === null
    ? null
    : {
        draft,
        kind: source.kind,
        submitterDisplayName: source.submitterDisplayName,
      };
}

export function projectAdminDeletedApprovalWork(
  source: Readonly<ApprovalWorkDeletionSource>,
  context: AuthorizedRequestContext,
): object | null {
  const active = projectAdminActiveApprovalWork(source, context);
  const record = source.kind === "submission" ? source.entry : source.draft;
  if (
    active === null ||
    record.deletedAt === null ||
    record.deletedByUserId === null ||
    record.deleteReason === null
  ) {
    return null;
  }
  const deletion = {
    deletedAt: record.deletedAt,
    deletedByUserId: record.deletedByUserId,
    reason: record.deleteReason,
  };
  return { ...active, deletion };
}
