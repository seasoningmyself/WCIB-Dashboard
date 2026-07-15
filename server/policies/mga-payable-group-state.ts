import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  mgaPayableGroupStateRequestSchema,
  type MgaPayableGroupStateRequest,
} from "../../shared/mga-payables.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { inActiveBusinessGeneration } from "../db/business-state.js";
import { policies } from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import {
  MgaPayableBoundsError,
  MgaPayableNotFoundError,
} from "./mga-payables.js";
import { requirePolicyLedgerAdmin } from "./ledger-access.js";
import {
  applyMgaPayableStateInTransaction,
  mapMgaPayableStateError,
  type MgaPayableStateChangeResult,
  type MgaPayableStateOperations,
  MgaPayableStateValidationError,
} from "./mga-payable-state.js";

const MAX_GROUP_POLICIES = 5_000;

export interface MgaPayableGroupStateChangeResult {
  results: readonly MgaPayableStateChangeResult[];
  status: MgaPayableGroupStateRequest["status"];
}

export async function changeMgaPayableGroupState(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  mgaId: string,
  rawInput: unknown,
  logger: AppLogger,
  changedAt = new Date(),
  operations?: MgaPayableStateOperations,
): Promise<MgaPayableGroupStateChangeResult> {
  requirePolicyLedgerAdmin(context);
  const input = mgaPayableGroupStateRequestSchema.parse(rawInput);
  if (Number.isNaN(changedAt.getTime())) {
    throw new MgaPayableStateValidationError();
  }

  try {
    const result = await database.transaction(async (transaction) => {
      await transaction.execute(sql`
        select active_generation_id
        from business_state_control
        where singleton_id = 1
        for share
      `);
      const rows = await transaction
        .select({ id: policies.id, mgaPaid: policies.mgaPaid })
        .from(policies)
        .where(
          and(
            eq(policies.mgaId, mgaId),
            isNull(policies.deletedAt),
            inActiveBusinessGeneration(policies.businessGenerationId),
          ),
        )
        .orderBy(asc(policies.id))
        .limit(MAX_GROUP_POLICIES + 1)
        .for("update");
      if (rows.length === 0) throw new MgaPayableNotFoundError();
      if (rows.length > MAX_GROUP_POLICIES) throw new MgaPayableBoundsError();

      const targetPaid = input.status === "paid";
      const changed: MgaPayableStateChangeResult[] = [];
      for (const row of rows) {
        if (row.mgaPaid === targetPaid) continue;
        changed.push(
          await applyMgaPayableStateInTransaction(
            transaction,
            context,
            row.id,
            { reference: null, status: input.status },
            logger,
            changedAt,
            operations,
          ),
        );
      }
      return { results: changed, status: input.status };
    });
    logger.info("MGA payable group transaction committed", {
      actorUserId: context.principal.userId,
      changedCount: result.results.length,
      component: "mga_payables",
      event: "mga_payable_group_state_committed",
      mgaId,
      status: input.status,
    });
    return result;
  } catch (error) {
    logger.error(
      "MGA payable group transaction failed",
      {
        actorUserId: context.principal.userId,
        component: "mga_payables",
        event: "mga_payable_group_state_failed",
        mgaId,
        status: input.status,
      },
      error,
    );
    throw mapMgaPayableStateError(error);
  }
}
