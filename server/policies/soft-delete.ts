import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  policyRestoreRequestSchema,
  policySoftDeleteRequestSchema,
} from "../../shared/policy-deletions.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import type { AppLogger } from "../logging/logger.js";
import {
  getDeletedPolicyLedgerItem,
  getPolicyLedgerItem,
  type DeletedPolicyLedgerSourceItem,
  type PolicyLedgerSourceItem,
} from "./ledger.js";
import { requirePolicyLedgerAdmin } from "./ledger-access.js";

const databaseDeleteResultSchema = z
  .object({
    changed: z.boolean(),
    detachedOpenSheetCount: z.number().int().nonnegative(),
    policyId: z.string().uuid(),
  })
  .strict();

const databaseRestoreResultSchema = z
  .object({
    changed: z.boolean(),
    policyId: z.string().uuid(),
    restoredPlacementCount: z.number().int().nonnegative(),
  })
  .strict();

export interface PolicySoftDeleteResult {
  changed: boolean;
  detachedOpenSheetCount: number;
  source: DeletedPolicyLedgerSourceItem;
}

export interface PolicyRestoreResult {
  changed: boolean;
  source: PolicyLedgerSourceItem;
}

export class PolicyDeletionNotFoundError extends Error {
  constructor() {
    super("Policy was not found");
    this.name = "PolicyDeletionNotFoundError";
  }
}

export class PolicyDeletionStaleError extends Error {
  constructor() {
    super("Policy version is stale");
    this.name = "PolicyDeletionStaleError";
  }
}

export class PolicyDeletionValidationError extends Error {
  constructor() {
    super("Policy deletion request is invalid");
    this.name = "PolicyDeletionValidationError";
  }
}

export async function softDeletePolicy(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  policyId: string,
  rawInput: unknown,
  logger: AppLogger,
  changedAt = new Date(),
): Promise<PolicySoftDeleteResult> {
  const actorUserId = requirePolicyLedgerAdmin(context);
  const input = policySoftDeleteRequestSchema.parse(rawInput);
  requireTimestamp(changedAt);
  try {
    const result = await database.execute<{ mutation: unknown }>(sql`
      select soft_delete_policy(
        ${policyId}::uuid,
        ${actorUserId}::uuid,
        ${input.reason}::text,
        ${input.expectedUpdatedAt}::timestamp with time zone,
        ${changedAt}::timestamp with time zone
      ) as mutation
    `);
    const mutation = databaseDeleteResultSchema.parse(result.rows[0]?.mutation);
    if (mutation.policyId !== policyId) {
      throw new PolicyDeletionValidationError();
    }
    const source = await getDeletedPolicyLedgerItem(database, context, policyId);
    logger.info("Policy moved to deleted records", {
      actorUserId,
      changed: mutation.changed,
      component: "policy_deletion",
      detachedOpenSheetCount: mutation.detachedOpenSheetCount,
      event: "policy_soft_delete_succeeded",
      policyId,
    });
    return {
      changed: mutation.changed,
      detachedOpenSheetCount: mutation.detachedOpenSheetCount,
      source,
    };
  } catch (error) {
    logger.error(
      "Policy soft-delete failed",
      {
        actorUserId,
        component: "policy_deletion",
        event: "policy_soft_delete_failed",
        policyId,
      },
      error,
    );
    throw mapPolicyDeletionDatabaseError(error);
  }
}

export async function restorePolicy(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  policyId: string,
  rawInput: unknown,
  logger: AppLogger,
  changedAt = new Date(),
): Promise<PolicyRestoreResult> {
  const actorUserId = requirePolicyLedgerAdmin(context);
  const input = policyRestoreRequestSchema.parse(rawInput);
  requireTimestamp(changedAt);
  try {
    const result = await database.execute<{ mutation: unknown }>(sql`
      select restore_policy(
        ${policyId}::uuid,
        ${actorUserId}::uuid,
        ${input.expectedUpdatedAt}::timestamp with time zone,
        ${changedAt}::timestamp with time zone
      ) as mutation
    `);
    const mutation = databaseRestoreResultSchema.parse(result.rows[0]?.mutation);
    if (mutation.policyId !== policyId) {
      throw new PolicyDeletionValidationError();
    }
    const source = await getPolicyLedgerItem(database, context, policyId);
    logger.info("Policy restored to live records", {
      actorUserId,
      changed: mutation.changed,
      component: "policy_deletion",
      event: "policy_restore_succeeded",
      policyId,
      restoredPlacementCount: mutation.restoredPlacementCount,
    });
    return { changed: mutation.changed, source };
  } catch (error) {
    logger.error(
      "Policy restore failed",
      {
        actorUserId,
        component: "policy_deletion",
        event: "policy_restore_failed",
        policyId,
      },
      error,
    );
    throw mapPolicyDeletionDatabaseError(error);
  }
}

function mapPolicyDeletionDatabaseError(error: unknown): unknown {
  if (
    error instanceof PolicyDeletionNotFoundError ||
    error instanceof PolicyDeletionStaleError ||
    error instanceof PolicyDeletionValidationError
  ) {
    return error;
  }
  const code = readDatabaseErrorCode(error);
  if (code === "P0002") return new PolicyDeletionNotFoundError();
  if (code === "40001") return new PolicyDeletionStaleError();
  if (
    code === "22004" ||
    code === "22P02" ||
    code === "23503" ||
    code === "23514" ||
    code === "55000"
  ) {
    return new PolicyDeletionValidationError();
  }
  return error;
}

function requireTimestamp(value: Date): void {
  if (Number.isNaN(value.getTime())) {
    throw new PolicyDeletionValidationError();
  }
}
