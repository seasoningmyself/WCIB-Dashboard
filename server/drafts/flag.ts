import { and, eq } from "drizzle-orm";
import {
  flagDraftRequestSchema,
  type FlagDraftRequest,
} from "../../shared/drafts.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { inActiveBusinessGeneration } from "../db/business-state.js";
import { drafts, type DraftRecord } from "../db/schema.js";
import { flagDraftForHelp } from "../policies/lifecycle.js";
import { requireDraftStaffActor } from "./access.js";

export class DraftFlagNotFoundError extends Error {
  constructor() {
    super("Draft was not found");
    this.name = "DraftFlagNotFoundError";
  }
}

export class DraftNotFlaggableError extends Error {
  constructor() {
    super("Draft is not flaggable");
    this.name = "DraftNotFlaggableError";
  }
}

export async function flagOwnDraft(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  draftId: string,
  rawInput: unknown,
  flaggedAt = new Date(),
): Promise<DraftRecord> {
  const ownerUserId = requireDraftStaffActor(context);
  const input: FlagDraftRequest = flagDraftRequestSchema.parse(rawInput);
  if (Number.isNaN(flaggedAt.getTime())) {
    throw new DraftNotFlaggableError();
  }

  return database.transaction(async (transaction) => {
    const [record] = await transaction
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
    if (record === undefined) {
      throw new DraftFlagNotFoundError();
    }
    if (record.status !== "draft" || flaggedAt < record.lastEditedAt) {
      throw new DraftNotFlaggableError();
    }

    await flagDraftForHelp(
      transaction,
      context,
      record.id,
      input.reason,
      flaggedAt,
    );
    const [updated] = await transaction
      .select()
      .from(drafts)
      .where(
        and(
          eq(drafts.id, record.id),
          inActiveBusinessGeneration(drafts.businessGenerationId),
        ),
      )
      .limit(1);
    if (updated === undefined) {
      throw new DraftNotFlaggableError();
    }
    return updated;
  });
}
