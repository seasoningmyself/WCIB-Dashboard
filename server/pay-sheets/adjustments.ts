import { sql } from "drizzle-orm";
import type {
  PaySheetAccountBasis,
  PaySheetAdjustmentType,
} from "../../shared/pay-sheet-adjustments.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import { requireLifecycleAdmin } from "../policies/lifecycle.js";

type AdjustmentDatabase = Pick<AuthDatabase, "execute">;

export interface PaySheetAdjustmentInput {
  readonly accountBasis: PaySheetAccountBasis;
  readonly adjustmentType: PaySheetAdjustmentType;
  readonly brokerFeeDelta: string;
  readonly commissionDelta: string;
  readonly effectiveDate: string;
  readonly incomeAmount: string;
  readonly insuredOrClientLabel: string;
  readonly paySheetId: string;
  readonly payoutDelta: string;
  readonly policyTypeId: string | null;
  readonly producerUserId: string | null;
  readonly reasonOrNote: string | null;
}

export class PaySheetAdjustmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaySheetAdjustmentError";
  }
}

export async function createPaySheetAdjustment(
  database: AdjustmentDatabase,
  context: AuthorizedRequestContext,
  input: PaySheetAdjustmentInput,
  logger: AppLogger,
  changedAt = new Date(),
): Promise<string> {
  return saveAdjustment(
    "create",
    database,
    context,
    null,
    input,
    logger,
    changedAt,
  );
}

export async function updatePaySheetAdjustment(
  database: AdjustmentDatabase,
  context: AuthorizedRequestContext,
  adjustmentId: string,
  input: PaySheetAdjustmentInput,
  logger: AppLogger,
  changedAt = new Date(),
): Promise<string> {
  return saveAdjustment(
    "update",
    database,
    context,
    adjustmentId,
    input,
    logger,
    changedAt,
  );
}

export async function deletePaySheetAdjustment(
  database: AdjustmentDatabase,
  context: AuthorizedRequestContext,
  adjustmentId: string,
  logger: AppLogger,
  changedAt = new Date(),
): Promise<string> {
  const actorUserId = context.principal.userId;
  try {
    requireLifecycleAdmin(context);
    requireTimestamp(changedAt);
    const result = await database.execute<{ adjustment_id: unknown }>(
      sql`select delete_pay_sheet_adjustment(
        ${adjustmentId}::uuid,
        ${actorUserId}::uuid,
        ${changedAt}::timestamp with time zone
      ) as adjustment_id`,
    );
    const returnedId = requireUuid(result.rows[0]?.adjustment_id);
    logger.info("Pay-sheet adjustment deleted", {
      actorUserId,
      adjustmentId: returnedId,
      component: "pay_sheet",
      event: "pay_sheet_adjustment_deleted",
    });
    return returnedId;
  } catch (error) {
    logAdjustmentFailure(logger, "delete", actorUserId, adjustmentId, error);
    throw error;
  }
}

async function saveAdjustment(
  action: "create" | "update",
  database: AdjustmentDatabase,
  context: AuthorizedRequestContext,
  adjustmentId: string | null,
  input: PaySheetAdjustmentInput,
  logger: AppLogger,
  changedAt: Date,
): Promise<string> {
  const actorUserId = context.principal.userId;
  try {
    requireLifecycleAdmin(context);
    requireTimestamp(changedAt);
    const result =
      action === "create"
        ? await database.execute<{ adjustment_id: unknown }>(
            sql`select create_pay_sheet_adjustment(
              ${actorUserId}::uuid,
              ${input.paySheetId}::uuid,
              ${input.adjustmentType}::pay_sheet_adjustment_type,
              ${input.effectiveDate}::date,
              ${input.insuredOrClientLabel}::text,
              ${input.policyTypeId}::uuid,
              ${input.accountBasis}::pay_sheet_account_basis,
              ${input.producerUserId}::uuid,
              ${input.brokerFeeDelta}::numeric,
              ${input.commissionDelta}::numeric,
              ${input.payoutDelta}::numeric,
              ${input.incomeAmount}::numeric,
              ${input.reasonOrNote}::text,
              ${changedAt}::timestamp with time zone
            ) as adjustment_id`,
          )
        : await database.execute<{ adjustment_id: unknown }>(
            sql`select update_pay_sheet_adjustment(
              ${adjustmentId}::uuid,
              ${actorUserId}::uuid,
              ${input.paySheetId}::uuid,
              ${input.adjustmentType}::pay_sheet_adjustment_type,
              ${input.effectiveDate}::date,
              ${input.insuredOrClientLabel}::text,
              ${input.policyTypeId}::uuid,
              ${input.accountBasis}::pay_sheet_account_basis,
              ${input.producerUserId}::uuid,
              ${input.brokerFeeDelta}::numeric,
              ${input.commissionDelta}::numeric,
              ${input.payoutDelta}::numeric,
              ${input.incomeAmount}::numeric,
              ${input.reasonOrNote}::text,
              ${changedAt}::timestamp with time zone
            ) as adjustment_id`,
          );
    const returnedId = requireUuid(result.rows[0]?.adjustment_id);
    logger.info(`Pay-sheet adjustment ${action}d`, {
      actorUserId,
      adjustmentId: returnedId,
      adjustmentType: input.adjustmentType,
      component: "pay_sheet",
      event: `pay_sheet_adjustment_${action}d`,
      paySheetId: input.paySheetId,
    });
    return returnedId;
  } catch (error) {
    logAdjustmentFailure(
      logger,
      action,
      actorUserId,
      adjustmentId,
      error,
    );
    throw error;
  }
}

function logAdjustmentFailure(
  logger: AppLogger,
  action: "create" | "delete" | "update",
  actorUserId: string,
  adjustmentId: string | null,
  error: unknown,
): void {
  logger.error(
    "Pay-sheet adjustment mutation failed",
    {
      action,
      actorUserId,
      adjustmentId,
      component: "pay_sheet",
      event: "pay_sheet_adjustment_failed",
    },
    error,
  );
}

function requireTimestamp(value: Date): void {
  if (Number.isNaN(value.getTime())) {
    throw new PaySheetAdjustmentError(
      "A valid pay-sheet adjustment timestamp is required",
    );
  }
}

function requireUuid(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new PaySheetAdjustmentError(
      "Pay-sheet adjustment returned an invalid identity",
    );
  }
  return value;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
