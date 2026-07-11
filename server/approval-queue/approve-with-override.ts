import { eq } from "drizzle-orm";
import {
  approveWithOverrideRequestSchema,
  type ApproveWithOverrideRequest,
} from "../../shared/policy-overrides.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import {
  approvalQueueEntries,
  policies,
  type PolicyRecord,
} from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import { approveQueuedPolicyInTransaction } from "../policies/lifecycle.js";
import { buildPolicyOverrideValuePair } from "../policies/override-values.js";
import { applyPolicyOverride } from "../policies/overrides.js";
import { requireApprovalAdmin } from "./access.js";
import {
  ApprovalItemNotFoundError,
  ApprovalItemStateError,
  ApprovalSnapshotError,
} from "./approve.js";
import { parseDraftSubmissionSnapshot } from "./snapshot.js";

export interface ApprovalWithOverrideResult {
  overrideId: string;
  policy: PolicyRecord;
}

export class ApprovalOverrideValidationError extends Error {
  constructor() {
    super("Approval override is invalid");
    this.name = "ApprovalOverrideValidationError";
  }
}

export async function approvePendingSubmissionWithOverride(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  queueEntryId: string,
  rawInput: unknown,
  logger: AppLogger,
  approvedAt = new Date(),
): Promise<ApprovalWithOverrideResult> {
  requireApprovalAdmin(context);
  const input: ApproveWithOverrideRequest =
    approveWithOverrideRequestSchema.parse(rawInput);
  if (Number.isNaN(approvedAt.getTime())) {
    throw new ApprovalItemStateError();
  }

  return database.transaction(async (transaction) => {
    const [entry] = await transaction
      .select()
      .from(approvalQueueEntries)
      .where(eq(approvalQueueEntries.id, queueEntryId))
      .limit(1)
      .for("update");
    if (entry === undefined) {
      throw new ApprovalItemNotFoundError();
    }
    if (entry.status !== "pending" || approvedAt < entry.submittedAt) {
      throw new ApprovalItemStateError();
    }

    let snapshot;
    try {
      snapshot = parseDraftSubmissionSnapshot(entry.submittedPayload);
    } catch {
      throw new ApprovalSnapshotError();
    }
    try {
      buildPolicyOverrideValuePair(
        { ...snapshot },
        input.replacementValues,
        input.changedFields,
      );
    } catch {
      throw new ApprovalOverrideValidationError();
    }

    const approvedPolicy = await approveQueuedPolicyInTransaction(
      transaction,
      context,
      queueEntryId,
      snapshot,
      approvedAt,
    );
    const overrideId = await applyPolicyOverride(
      transaction,
      context,
      approvedPolicy.id,
      input.reason,
      input.replacementValues,
      input.changedFields,
      logger,
      approvedAt,
    );
    const [policy] = await transaction
      .select()
      .from(policies)
      .where(eq(policies.id, approvedPolicy.id))
      .limit(1);
    if (policy === undefined || !policy.overridden) {
      throw new ApprovalItemStateError();
    }
    return { overrideId, policy };
  });
}
