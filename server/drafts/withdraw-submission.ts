import { and, eq } from "drizzle-orm";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import { drafts, type DraftRecord } from "../db/schema.js";
import { withdrawPendingSubmission } from "../policies/lifecycle.js";
import { requireDraftStaffActor } from "./access.js";

export class DraftSubmissionWithdrawalNotFoundError extends Error {
  constructor() {
    super("Draft was not found");
    this.name = "DraftSubmissionWithdrawalNotFoundError";
  }
}

export class DraftSubmissionWithdrawalNotAllowedError extends Error {
  constructor() {
    super("Draft submission cannot be withdrawn");
    this.name = "DraftSubmissionWithdrawalNotAllowedError";
  }
}

export async function withdrawOwnSubmittedDraft(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  draftId: string,
  withdrawnAt = new Date(),
): Promise<DraftRecord> {
  const ownerUserId = requireDraftStaffActor(context);
  if (Number.isNaN(withdrawnAt.getTime())) {
    throw new DraftSubmissionWithdrawalNotAllowedError();
  }

  try {
    return await database.transaction(async (transaction) => {
      await withdrawPendingSubmission(
        transaction,
        context,
        draftId,
        withdrawnAt,
      );
      const [updated] = await transaction
        .select()
        .from(drafts)
        .where(
          and(eq(drafts.id, draftId), eq(drafts.ownerUserId, ownerUserId)),
        )
        .limit(1);
      if (updated === undefined) {
        throw new DraftSubmissionWithdrawalNotFoundError();
      }
      return updated;
    });
  } catch (error) {
    const code = readDatabaseErrorCode(error);
    if (code === "42501" || code === "P0002") {
      throw new DraftSubmissionWithdrawalNotFoundError();
    }
    if (code === "23514" || code === "40001" || code === "55000") {
      throw new DraftSubmissionWithdrawalNotAllowedError();
    }
    throw error;
  }
}
