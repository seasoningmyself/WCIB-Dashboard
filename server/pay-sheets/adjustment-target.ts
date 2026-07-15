import { and, eq } from "drizzle-orm";
import {
  paySheetAdjustmentMutationSchema,
  type PaySheetAdjustmentMutation,
} from "../../shared/pay-sheet-adjustment-api.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { inActiveBusinessGeneration } from "../db/business-state.js";
import { paySheetAdjustments, paySheets } from "../db/schema.js";
import { requirePolicyLedgerAdmin } from "../policies/ledger-access.js";

type AdjustmentTargetDatabase = Pick<AuthDatabase, "select">;

export interface PaySheetAdjustmentTarget {
  adjustmentId: string;
  ownerType: "producer" | "sophia";
  paySheetId: string;
  status: "closed" | "open";
}

export class PaySheetAdjustmentNotFoundError extends Error {
  constructor() {
    super("Pay-sheet adjustment was not found");
    this.name = "PaySheetAdjustmentNotFoundError";
  }
}

export async function getPaySheetAdjustmentTarget(
  database: AdjustmentTargetDatabase,
  context: AuthorizedRequestContext,
  adjustmentId: string,
): Promise<PaySheetAdjustmentTarget> {
  requirePolicyLedgerAdmin(context);
  const [target] = await database
    .select({
      adjustmentId: paySheetAdjustments.id,
      ownerType: paySheets.ownerType,
      paySheetId: paySheetAdjustments.paySheetId,
      status: paySheets.status,
    })
    .from(paySheetAdjustments)
    .innerJoin(paySheets, eq(paySheets.id, paySheetAdjustments.paySheetId))
    .where(
      and(
        eq(paySheetAdjustments.id, adjustmentId),
        inActiveBusinessGeneration(paySheetAdjustments.businessGenerationId),
        inActiveBusinessGeneration(paySheets.businessGenerationId),
      ),
    )
    .limit(1);
  if (target === undefined) throw new PaySheetAdjustmentNotFoundError();
  return target;
}

export function projectAdminPaySheetAdjustmentMutation(
  source: Readonly<PaySheetAdjustmentMutation>,
  context: AuthorizedRequestContext,
): PaySheetAdjustmentMutation | null {
  requirePolicyLedgerAdmin(context);
  return paySheetAdjustmentMutationSchema.parse({
    action: source.action,
    adjustmentId: source.adjustmentId,
    paySheetId: source.paySheetId,
  });
}
