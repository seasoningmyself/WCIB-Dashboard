import type { MyItem } from "../../shared/my-items.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { DraftRecord } from "../db/schema.js";

export const MY_ITEM_FIELDS = [
  "id",
  "lastActivityAt",
  "reason",
  "status",
  "submittedAt",
  "title",
] as const satisfies readonly (keyof MyItem)[];

export function projectMyItemForAuthorizedContext(
  source: Readonly<DraftRecord>,
  context: AuthorizedRequestContext,
): MyItem | null {
  const { principal } = context;
  const ownsItem =
    principal.userActive &&
    (principal.staffRole === "employee" || principal.staffRole === "producer") &&
    principal.userId === source.ownerUserId;
  if (!ownsItem) return null;

  return {
    id: source.id,
    lastActivityAt: source.lastEditedAt.toISOString(),
    reason: statusReason(source),
    status: source.status,
    submittedAt: source.submittedAt?.toISOString() ?? null,
    title:
      boundedText(source.insuredName, 300) ??
      boundedText(source.companyName, 300) ??
      "Untitled turn-in",
  };
}

function statusReason(source: Readonly<DraftRecord>): string | null {
  if (source.status === "flagged") {
    return boundedText(source.flagReason, 500);
  }
  if (source.status === "sent_back") {
    return boundedText(source.sentBackReason, 500);
  }
  return null;
}

function boundedText(value: string | null, maxLength: number): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  return normalized.slice(0, maxLength);
}
