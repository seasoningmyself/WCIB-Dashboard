import { and, eq } from "drizzle-orm";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { drafts, type DraftRecord } from "../db/schema.js";
import { withdrawFlaggedHelp } from "../policies/lifecycle.js";
import { requireDraftStaffActor } from "./access.js";

export class DraftHelpWithdrawalNotFoundError extends Error {
  constructor() {
    super("Draft was not found");
    this.name = "DraftHelpWithdrawalNotFoundError";
  }
}

export class DraftHelpWithdrawalNotAllowedError extends Error {
  constructor() {
    super("Draft help request cannot be withdrawn");
    this.name = "DraftHelpWithdrawalNotAllowedError";
  }
}

export async function withdrawOwnFlaggedHelp(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  draftId: string,
  withdrawnAt = new Date(),
): Promise<DraftRecord> {
  const ownerUserId = requireDraftStaffActor(context);
  if (Number.isNaN(withdrawnAt.getTime())) {
    throw new DraftHelpWithdrawalNotAllowedError();
  }

  return database.transaction(async (transaction) => {
    const [record] = await transaction
      .select()
      .from(drafts)
      .where(
        and(eq(drafts.id, draftId), eq(drafts.ownerUserId, ownerUserId)),
      )
      .limit(1)
      .for("update");
    if (record === undefined) {
      throw new DraftHelpWithdrawalNotFoundError();
    }
    if (record.status !== "flagged" || withdrawnAt < record.lastEditedAt) {
      throw new DraftHelpWithdrawalNotAllowedError();
    }

    await withdrawFlaggedHelp(
      transaction,
      context,
      record.id,
      withdrawnAt,
    );
    const [updated] = await transaction
      .select()
      .from(drafts)
      .where(eq(drafts.id, record.id))
      .limit(1);
    if (updated === undefined) {
      throw new DraftHelpWithdrawalNotAllowedError();
    }
    return updated;
  });
}
