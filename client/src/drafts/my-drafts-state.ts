import { draftIdParamsSchema, type DraftResponse } from "../../../shared/drafts.js";

export type DraftSelection =
  | { status: "list" }
  | { draftId: string; status: "selected" }
  | { status: "invalid" };

export function resolveDraftSelection(rawPath: string): DraftSelection {
  const query = rawPath.split("?", 2)[1];
  if (query === undefined || query === "") {
    return { status: "list" };
  }
  const params = new URLSearchParams(query.split("#", 1)[0]);
  const values = params.getAll("draft");
  if (values.length === 0) {
    return { status: "list" };
  }
  if (values.length !== 1) {
    return { status: "invalid" };
  }
  const parsed = draftIdParamsSchema.safeParse({ draftId: values[0] });
  return parsed.success
    ? { draftId: parsed.data.draftId, status: "selected" }
    : { status: "invalid" };
}

export function sortOwnDrafts(
  drafts: readonly DraftResponse[],
): DraftResponse[] {
  return [...drafts].sort((left, right) => {
    const byEdited = right.lastEditedAt.localeCompare(left.lastEditedAt);
    return byEdited === 0 ? left.id.localeCompare(right.id) : byEdited;
  });
}

export function replaceProjectedDraft(
  drafts: readonly DraftResponse[],
  replacement: DraftResponse,
): DraftResponse[] {
  const replaced = drafts.some(({ id }) => id === replacement.id)
    ? drafts.map((draft) => (draft.id === replacement.id ? replacement : draft))
    : [...drafts, replacement];
  return sortOwnDrafts(replaced);
}

export function draftStatusLabel(status: DraftResponse["status"]): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "submitted":
      return "Submitted";
    case "flagged":
      return "Help requested";
    case "sent_back":
      return "Sent back";
    case "approved":
      return "Approved";
  }
}

export function draftActionLabel(status: DraftResponse["status"]): string {
  if (status === "draft") return "Edit";
  if (status === "sent_back") return "Review and reopen";
  if (status === "flagged" || status === "submitted") {
    return "Reopen and edit";
  }
  return "View status";
}
