import { sql } from "drizzle-orm";
import type { PolicyCorrectionField } from "../../shared/policy-corrections.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import { buildPolicyCorrectionReplacement } from "./correction-values.js";
import { requireLifecycleAdmin } from "./lifecycle.js";

type PolicyCorrectionDatabase = Pick<AuthDatabase, "execute">;

export class PolicyCorrectionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyCorrectionStateError";
  }
}

export async function applyPolicyCorrection(
  database: PolicyCorrectionDatabase,
  context: AuthorizedRequestContext,
  policyId: string,
  reason: string,
  replacementSource: Readonly<Record<string, unknown>>,
  changedFields: readonly PolicyCorrectionField[],
  expectedUpdatedAt: Date,
  logger: AppLogger,
  correctedAt = new Date(),
): Promise<string> {
  const actorUserId = context.principal.userId;
  try {
    requireLifecycleAdmin(context);
    if (
      Number.isNaN(expectedUpdatedAt.getTime()) ||
      Number.isNaN(correctedAt.getTime()) ||
      correctedAt <= expectedUpdatedAt
    ) {
      throw new PolicyCorrectionStateError(
        "Valid correction version timestamps are required",
      );
    }
    const replacementValues = buildPolicyCorrectionReplacement(
      replacementSource,
      changedFields,
    );
    const result = await database.execute<{ audit_event_id: string }>(
      sql`select apply_policy_correction(
        ${policyId}::uuid,
        ${actorUserId}::uuid,
        ${reason}::text,
        ${JSON.stringify(replacementValues)}::json,
        ${expectedUpdatedAt}::timestamp with time zone,
        ${correctedAt}::timestamp with time zone
      ) as audit_event_id`,
    );
    const auditEventId = result.rows[0]?.audit_event_id;
    if (auditEventId === undefined) {
      throw new PolicyCorrectionStateError(
        "Policy correction returned no audit event ID",
      );
    }
    logger.info("Policy correction applied", {
      actorUserId,
      auditEventId,
      component: "policy_correction",
      event: "correction_succeeded",
      policyId,
    });
    return auditEventId;
  } catch (error) {
    logger.error(
      "Policy correction failed",
      {
        actorUserId,
        component: "policy_correction",
        event: "correction_failed",
        policyId,
      },
      error,
    );
    throw error;
  }
}
