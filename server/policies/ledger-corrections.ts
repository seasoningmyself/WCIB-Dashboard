import { eq } from "drizzle-orm";
import {
  policyLedgerCorrectionRequestSchema,
  type PolicyLedgerCorrectionRequest,
} from "../../shared/policy-corrections.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import { policies, type PolicyRecord } from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import { applyPolicyCorrection } from "./corrections.js";
import { requirePolicyLedgerAdmin } from "./ledger-access.js";
import { buildPolicyOverrideValuePair } from "./override-values.js";
import { applyPolicyOverride } from "./overrides.js";

export interface PolicyLedgerCorrectionResult {
  kind: PolicyLedgerCorrectionRequest["kind"];
  mutationId: string;
  policy: PolicyRecord;
}

export class PolicyLedgerCorrectionNotFoundError extends Error {
  constructor() {
    super("Policy was not found");
    this.name = "PolicyLedgerCorrectionNotFoundError";
  }
}

export class PolicyLedgerCorrectionStaleError extends Error {
  constructor() {
    super("Policy version is stale");
    this.name = "PolicyLedgerCorrectionStaleError";
  }
}

export class PolicyLedgerCorrectionValidationError extends Error {
  constructor() {
    super("Policy correction is invalid");
    this.name = "PolicyLedgerCorrectionValidationError";
  }
}

export async function correctPolicyLedgerItem(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  policyId: string,
  rawInput: unknown,
  logger: AppLogger,
  correctedAt = new Date(),
): Promise<PolicyLedgerCorrectionResult> {
  requirePolicyLedgerAdmin(context);
  const input = policyLedgerCorrectionRequestSchema.parse(rawInput);
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  if (
    Number.isNaN(expectedUpdatedAt.getTime()) ||
    Number.isNaN(correctedAt.getTime())
  ) {
    throw new PolicyLedgerCorrectionValidationError();
  }

  try {
    return await database.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(policies)
        .where(eq(policies.id, policyId))
        .limit(1)
        .for("update");
      if (current === undefined) {
        throw new PolicyLedgerCorrectionNotFoundError();
      }
      if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new PolicyLedgerCorrectionStaleError();
      }
      if (correctedAt <= current.updatedAt) {
        throw new PolicyLedgerCorrectionValidationError();
      }

      let mutationId: string;
      if (input.kind === "general") {
        mutationId = await applyPolicyCorrection(
          transaction,
          context,
          policyId,
          input.change.reason,
          input.change.replacementValues,
          input.change.changedFields,
          current.updatedAt,
          logger,
          correctedAt,
        );
      } else {
        try {
          buildPolicyOverrideValuePair(
            current,
            input.change.replacementValues,
            input.change.changedFields,
          );
        } catch {
          throw new PolicyLedgerCorrectionValidationError();
        }
        mutationId = await applyPolicyOverride(
          transaction,
          context,
          policyId,
          input.change.reason,
          input.change.replacementValues,
          input.change.changedFields,
          logger,
          correctedAt,
        );
      }

      const [updated] = await transaction
        .select()
        .from(policies)
        .where(eq(policies.id, policyId))
        .limit(1);
      if (updated === undefined) {
        throw new PolicyLedgerCorrectionNotFoundError();
      }
      return { kind: input.kind, mutationId, policy: updated };
    });
  } catch (error) {
    throw mapPolicyCorrectionDatabaseError(error);
  }
}

function mapPolicyCorrectionDatabaseError(error: unknown): unknown {
  if (
    error instanceof PolicyLedgerCorrectionNotFoundError ||
    error instanceof PolicyLedgerCorrectionStaleError ||
    error instanceof PolicyLedgerCorrectionValidationError
  ) {
    return error;
  }
  const code = readDatabaseErrorCode(error);
  if (code === "P0002") {
    return new PolicyLedgerCorrectionNotFoundError();
  }
  if (code === "40001") {
    return new PolicyLedgerCorrectionStaleError();
  }
  if (
    code === "22004" ||
    code === "22P02" ||
    code === "23503" ||
    code === "23505" ||
    code === "23514"
  ) {
    return new PolicyLedgerCorrectionValidationError();
  }
  return error;
}
