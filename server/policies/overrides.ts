import { sql } from "drizzle-orm";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import type { PolicyOverrideField } from "../../shared/policy-overrides.js";
import { requireLifecycleAdmin } from "./lifecycle.js";
import { buildPolicyOverrideReplacement } from "./override-values.js";

type PolicyOverrideDatabase = Pick<AuthDatabase, "execute">;

export class PolicyOverrideStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyOverrideStateError";
  }
}

export async function applyPolicyOverride(
  database: PolicyOverrideDatabase,
  context: AuthorizedRequestContext,
  policyId: string,
  reason: string,
  replacementSource: Readonly<Record<string, unknown>>,
  changedFields: readonly PolicyOverrideField[],
  logger: AppLogger,
  createdAt = new Date(),
): Promise<string> {
  const actorUserId = context.principal.userId;
  try {
    requireLifecycleAdmin(context);
    if (Number.isNaN(createdAt.getTime())) {
      throw new PolicyOverrideStateError(
        "A valid override timestamp is required",
      );
    }
    const replacementValues = buildPolicyOverrideReplacement(
      replacementSource,
      changedFields,
    );
    const result = await database.execute<{ override_id: string }>(
      sql`select apply_policy_override(
        ${policyId}::uuid,
        ${actorUserId}::uuid,
        ${reason}::text,
        ${JSON.stringify(replacementValues)}::jsonb,
        ${createdAt}::timestamp with time zone
      ) as override_id`,
    );
    const overrideId = result.rows[0]?.override_id;
    if (overrideId === undefined) {
      throw new PolicyOverrideStateError("Override mutation returned no ID");
    }
    logger.info("Policy override applied", {
      actorUserId,
      component: "policy_override",
      event: "override_succeeded",
      overrideId,
      policyId,
    });
    return overrideId;
  } catch (error) {
    logger.error(
      "Policy override failed",
      {
        actorUserId,
        component: "policy_override",
        event: "override_failed",
        policyId,
      },
      error,
    );
    throw error;
  }
}
