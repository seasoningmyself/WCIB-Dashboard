import { and, eq } from "drizzle-orm";
import {
  createDraftRequestSchema,
  updateDraftRequestSchema,
} from "../../shared/drafts.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { inActiveBusinessGeneration } from "../db/business-state.js";
import { drafts, type DraftRecord } from "../db/schema.js";
import { reopenSentBackDraft } from "../policies/lifecycle.js";
import { requireDraftSelfServiceActor } from "./access.js";
import {
  buildDraftContentValues,
  validateActiveDraftReferences,
  validateDraftProducerAssignment,
} from "./create.js";
import { draftRecordToInput } from "./record.js";

export interface DraftEditResult {
  draft: DraftRecord;
  previousStatus: "draft" | "sent_back";
}

export class DraftNotFoundError extends Error {
  constructor() {
    super("Draft was not found");
    this.name = "DraftNotFoundError";
  }
}

export class DraftNotEditableError extends Error {
  constructor() {
    super("Draft is not editable");
    this.name = "DraftNotEditableError";
  }
}

export async function editOwnDraft(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  draftId: string,
  rawInput: unknown,
  editedAt = new Date(),
): Promise<DraftEditResult> {
  const ownerUserId = requireDraftSelfServiceActor(context);
  const patch = updateDraftRequestSchema.parse(rawInput);
  if (Number.isNaN(editedAt.getTime())) {
    throw new DraftNotEditableError();
  }

  return database.transaction(async (transaction) => {
    const [existing] = await transaction
      .select()
      .from(drafts)
      .where(
        and(
          eq(drafts.id, draftId),
          eq(drafts.ownerUserId, ownerUserId),
          inActiveBusinessGeneration(drafts.businessGenerationId),
        ),
      )
      .limit(1)
      .for("update");
    if (existing === undefined) {
      throw new DraftNotFoundError();
    }
    if (existing.status !== "draft" && existing.status !== "sent_back") {
      throw new DraftNotEditableError();
    }
    if (editedAt < existing.lastEditedAt) {
      throw new DraftNotEditableError();
    }

    const merged = createDraftRequestSchema.parse({
      ...draftRecordToInput(existing),
      ...patch,
    });
    validateDraftProducerAssignment(context, merged);
    await validateActiveDraftReferences(transaction, merged);

    const previousStatus = existing.status;
    if (previousStatus === "sent_back") {
      await reopenSentBackDraft(transaction, context, draftId, editedAt);
    }
    const [updated] = await transaction
      .update(drafts)
      .set({ ...buildDraftContentValues(merged), lastEditedAt: editedAt })
      .where(
        and(
          eq(drafts.id, draftId),
          eq(drafts.ownerUserId, ownerUserId),
          eq(drafts.status, "draft"),
          inActiveBusinessGeneration(drafts.businessGenerationId),
        ),
      )
      .returning();
    if (updated === undefined) {
      throw new DraftNotEditableError();
    }
    return { draft: updated, previousStatus };
  });
}
