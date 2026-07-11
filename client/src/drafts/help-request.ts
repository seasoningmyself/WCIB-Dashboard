import type { CurrentUser } from "../../../shared/current-user.js";
import {
  flagDraftRequestSchema,
  type DraftResponse,
} from "../../../shared/drafts.js";

export type HelpReasonResult =
  | { error: string; success: false }
  | { reason: string; success: true };

export function parseHelpReason(value: string): HelpReasonResult {
  const parsed = flagDraftRequestSchema.safeParse({ reason: value });
  if (parsed.success) {
    return { reason: parsed.data.reason, success: true };
  }
  return {
    error:
      value.trim() === ""
        ? "Explain what you need help with."
        : "Keep the help reason to 500 characters or fewer.",
    success: false,
  };
}

export function canRequestDraftHelp(
  user: CurrentUser,
  draft: DraftResponse | null,
): boolean {
  return (
    draft?.status === "draft" &&
    draft.ownerUserId === user.id &&
    (user.role === "employee" || user.role === "producer")
  );
}
