import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  discardDraftRequestSchema,
} from "../../shared/drafts.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { inActiveBusinessGeneration } from "../db/business-state.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import { drafts, type DraftRecord } from "../db/schema.js";
import { requireDraftSelfServiceActor } from "./access.js";

const discardMutationSchema = z
  .object({
    changed: z.boolean(),
    draftId: z.string().uuid(),
    kind: z.literal("draft"),
    targetId: z.string().uuid(),
  })
  .strict();

export class DraftDiscardNotFoundError extends Error {
  constructor() {
    super("Owned draft was not found");
    this.name = "DraftDiscardNotFoundError";
  }
}

export class DraftDiscardStaleError extends Error {
  constructor() {
    super("Draft version is stale");
    this.name = "DraftDiscardStaleError";
  }
}

export class DraftDiscardStateError extends Error {
  constructor() {
    super("Draft cannot be discarded in its current state");
    this.name = "DraftDiscardStateError";
  }
}

export async function discardOwnDraft(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  draftId: string,
  rawInput: unknown,
  changedAt = new Date(),
): Promise<DraftRecord> {
  const actorUserId = requireDraftSelfServiceActor(context);
  const input = discardDraftRequestSchema.parse(rawInput);
  if (Number.isNaN(changedAt.getTime())) {
    throw new DraftDiscardStateError();
  }

  try {
    const result = await database.execute<{ mutation: unknown }>(sql`
      select soft_delete_own_draft(
        ${draftId}::uuid,
        ${actorUserId}::uuid,
        ${input.expectedLastEditedAt}::timestamp with time zone,
        ${changedAt}::timestamp with time zone
      ) as mutation
    `);
    const mutation = discardMutationSchema.parse(result.rows[0]?.mutation);
    if (mutation.draftId !== draftId || mutation.targetId !== draftId) {
      throw new DraftDiscardStateError();
    }
    const [record] = await database
      .select()
      .from(drafts)
      .where(
        and(
          eq(drafts.id, draftId),
          eq(drafts.ownerUserId, actorUserId),
          isNotNull(drafts.deletedAt),
          inActiveBusinessGeneration(drafts.businessGenerationId),
        ),
      )
      .limit(1);
    if (record === undefined) throw new DraftDiscardNotFoundError();
    return record;
  } catch (error) {
    if (
      error instanceof DraftDiscardNotFoundError ||
      error instanceof DraftDiscardStaleError ||
      error instanceof DraftDiscardStateError
    ) {
      throw error;
    }
    const code = readDatabaseErrorCode(error);
    if (code === "P0002") throw new DraftDiscardNotFoundError();
    if (code === "40001") throw new DraftDiscardStaleError();
    if (code === "23514" || code === "55000") {
      throw new DraftDiscardStateError();
    }
    throw error;
  }
}
