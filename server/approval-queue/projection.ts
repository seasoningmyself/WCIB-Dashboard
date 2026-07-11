import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { ApprovalQueueEntryRecord } from "../db/schema.js";

const ADMIN_QUEUE_FIELDS = [
  "id",
  "draftId",
  "submittedByUserId",
  "submittedPayload",
  "status",
  "reason",
  "actedByUserId",
  "actedAt",
  "submittedAt",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof ApprovalQueueEntryRecord)[];

export const OWN_APPROVAL_STATUS_FIELDS = [
  "id",
  "draftId",
  "status",
  "submittedAt",
  "updatedAt",
] as const satisfies readonly (keyof ApprovalQueueEntryRecord)[];

export type AdminApprovalQueueProjection = Pick<
  ApprovalQueueEntryRecord,
  (typeof ADMIN_QUEUE_FIELDS)[number]
>;

export type OwnApprovalStatusProjection = Pick<
  ApprovalQueueEntryRecord,
  (typeof OWN_APPROVAL_STATUS_FIELDS)[number]
>;

export function projectAdminApprovalQueueEntry(
  source: Readonly<ApprovalQueueEntryRecord>,
  context: AuthorizedRequestContext,
): AdminApprovalQueueProjection | null {
  const { principal } = context;
  return principal.userActive && principal.capabilities.includes("admin")
    ? pickFields(source, ADMIN_QUEUE_FIELDS)
    : null;
}

export function projectOwnApprovalStatus(
  source: Readonly<ApprovalQueueEntryRecord>,
  context: AuthorizedRequestContext,
): OwnApprovalStatusProjection | null {
  const { principal } = context;
  const staffCanReadOwnStatus =
    principal.userActive &&
    (principal.staffRole === "employee" || principal.staffRole === "producer") &&
    principal.userId === source.submittedByUserId;

  return staffCanReadOwnStatus
    ? pickFields(source, OWN_APPROVAL_STATUS_FIELDS)
    : null;
}

function pickFields<
  TSource extends object,
  const TKeys extends readonly (keyof TSource)[],
>(source: Readonly<TSource>, fields: TKeys): Pick<TSource, TKeys[number]> {
  return Object.fromEntries(fields.map((field) => [field, source[field]])) as Pick<
    TSource,
    TKeys[number]
  >;
}
