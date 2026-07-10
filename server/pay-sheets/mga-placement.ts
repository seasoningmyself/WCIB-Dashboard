import { sql } from "drizzle-orm";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import { requireLifecycleAdmin } from "../policies/lifecycle.js";

type PlacementDatabase = Pick<AuthDatabase, "execute">;

export interface MgaPaySheetPlacementResult {
  associationCount: number;
  paySheetIds: readonly string[];
}

export class MgaPaySheetPlacementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MgaPaySheetPlacementError";
  }
}

export async function syncMgaPaymentSheetPlacement(
  database: PlacementDatabase,
  context: AuthorizedRequestContext,
  policyId: string,
  paid: boolean,
  logger: AppLogger,
  changedAt = new Date(),
): Promise<MgaPaySheetPlacementResult> {
  const actorUserId = context.principal.userId;
  const action = paid ? "attach" : "detach";
  try {
    requireLifecycleAdmin(context);
    if (Number.isNaN(changedAt.getTime())) {
      throw new MgaPaySheetPlacementError(
        "A valid pay-sheet placement timestamp is required",
      );
    }
    const result = await database.execute<{ placement: unknown }>(
      sql`select sync_mga_payment_sheet_placement(
        ${policyId}::uuid,
        ${actorUserId}::uuid,
        ${paid}::boolean,
        ${changedAt}::timestamp with time zone
      ) as placement`,
    );
    const placement = parsePlacement(result.rows[0]?.placement);
    logger.info("MGA pay-sheet placement applied", {
      action,
      actorUserId,
      associationCount: placement.associationCount,
      component: "pay_sheet",
      event: "mga_pay_sheet_placement_succeeded",
      paySheetIds: placement.paySheetIds,
      policyId,
    });
    return placement;
  } catch (error) {
    logger.error(
      "MGA pay-sheet placement failed",
      {
        action,
        actorUserId,
        component: "pay_sheet",
        event: "mga_pay_sheet_placement_failed",
        policyId,
      },
      error,
    );
    throw error;
  }
}

function parsePlacement(value: unknown): MgaPaySheetPlacementResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MgaPaySheetPlacementError(
      "Pay-sheet placement returned an invalid result",
    );
  }
  const candidate = value as Record<string, unknown>;
  if (
    !Number.isInteger(candidate.associationCount) ||
    (candidate.associationCount as number) < 0 ||
    !Array.isArray(candidate.paySheetIds) ||
    candidate.paySheetIds.some((id) => typeof id !== "string") ||
    candidate.paySheetIds.length !== candidate.associationCount
  ) {
    throw new MgaPaySheetPlacementError(
      "Pay-sheet placement returned an invalid result",
    );
  }
  return Object.freeze({
    associationCount: candidate.associationCount as number,
    paySheetIds: Object.freeze([...(candidate.paySheetIds as string[])]),
  });
}
