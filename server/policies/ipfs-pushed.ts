import { and, eq, isNull } from "drizzle-orm";
import { ipfsPushedStateRequestSchema } from "../../shared/ipfs.js";
import { writeAuditEventInDrizzleTransaction } from "../audit/event.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { inActiveBusinessGeneration } from "../db/business-state.js";
import { policies } from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import {
  getPolicyLedgerItem,
  type PolicyLedgerSourceItem,
} from "./ledger.js";
import { requirePolicyLedgerAdmin } from "./ledger-access.js";

export interface PolicyIpfsPushedResult {
  changed: boolean;
  source: PolicyLedgerSourceItem;
}

export class PolicyIpfsPushedNotFoundError extends Error {
  constructor() {
    super("Policy was not found");
    this.name = "PolicyIpfsPushedNotFoundError";
  }
}

export class PolicyIpfsPushedStaleError extends Error {
  constructor() {
    super("Policy version is stale");
    this.name = "PolicyIpfsPushedStaleError";
  }
}

export class PolicyIpfsPushedValidationError extends Error {
  constructor() {
    super("IPFS pushed-state request is invalid");
    this.name = "PolicyIpfsPushedValidationError";
  }
}

export async function setPolicyIpfsPushedState(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  policyId: string,
  rawInput: unknown,
  logger: AppLogger,
  changedAt = new Date(),
): Promise<PolicyIpfsPushedResult> {
  const actorUserId = requirePolicyLedgerAdmin(context);
  const input = ipfsPushedStateRequestSchema.parse(rawInput);
  if (Number.isNaN(changedAt.getTime())) {
    throw new PolicyIpfsPushedValidationError();
  }

  try {
    const changed = await database.transaction(async (transaction) => {
      const [policy] = await transaction
        .select({
          id: policies.id,
          ipfsFinanced: policies.ipfsFinanced,
          ipfsPushed: policies.ipfsPushed,
          paymentMode: policies.paymentMode,
          updatedAt: policies.updatedAt,
        })
        .from(policies)
        .where(
          and(
            eq(policies.id, policyId),
            isNull(policies.deletedAt),
            inActiveBusinessGeneration(policies.businessGenerationId),
          ),
        )
        .limit(1)
        .for("update");
      if (policy === undefined) {
        throw new PolicyIpfsPushedNotFoundError();
      }
      if (
        policy.paymentMode !== "deposit" ||
        policy.ipfsFinanced !== "yes"
      ) {
        throw new PolicyIpfsPushedValidationError();
      }
      if (policy.ipfsPushed === input.pushed) {
        return false;
      }
      if (policy.updatedAt.toISOString() !== input.expectedUpdatedAt) {
        throw new PolicyIpfsPushedStaleError();
      }
      if (changedAt.getTime() <= policy.updatedAt.getTime()) {
        throw new PolicyIpfsPushedValidationError();
      }

      await transaction
        .update(policies)
        .set({
          ipfsPushed: input.pushed,
          ipfsPushedAt: input.pushed ? changedAt : null,
          updatedAt: changedAt,
        })
        .where(
          and(
            eq(policies.id, policy.id),
            isNull(policies.deletedAt),
            inActiveBusinessGeneration(policies.businessGenerationId),
          ),
        );
      await writeAuditEventInDrizzleTransaction(
        transaction,
        context,
        {
          action: input.pushed
            ? "policy_ipfs_pushed"
            : "policy_ipfs_unpushed",
          after: {
            allowedFields: ["pushed"],
            source: { pushed: input.pushed },
          },
          before: {
            allowedFields: ["pushed"],
            source: { pushed: policy.ipfsPushed },
          },
          entityId: policy.id,
          entityType: "policy",
        },
        logger,
      );
      return true;
    });
    const source = await getPolicyLedgerItem(database, context, policyId);
    logger.info("Policy IPFS pushed state applied", {
      actorUserId,
      changed,
      component: "ipfs",
      event: "policy_ipfs_pushed_state_applied",
      policyId,
      pushed: input.pushed,
    });
    return { changed, source };
  } catch (error) {
    logger.error(
      "Policy IPFS pushed state failed",
      {
        actorUserId,
        component: "ipfs",
        event: "policy_ipfs_pushed_state_failed",
        policyId,
        pushed: input.pushed,
      },
      error,
    );
    throw error;
  }
}
