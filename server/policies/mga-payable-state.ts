import {
  mgaPayableStateRequestSchema,
  type MgaPayableStateRequest,
} from "../../shared/mga-payables.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import type { AppLogger } from "../logging/logger.js";
import {
  syncMgaPaymentSheetPlacement,
  type MgaPaySheetPlacementResult,
} from "../pay-sheets/mga-placement.js";
import {
  getMgaPayableSource,
  MgaPayableNotFoundError,
  type MgaPayableSourceItem,
} from "./mga-payables.js";
import { setMgaPaymentState } from "./mga-payments.js";

type MgaPayableTransaction = Pick<AuthDatabase, "execute" | "select">;

export interface MgaPayableStateChangeResult {
  placement: MgaPaySheetPlacementResult;
  source: MgaPayableSourceItem;
}

export interface MgaPayableStateOperations {
  get(
    database: MgaPayableTransaction,
    context: AuthorizedRequestContext,
    policyId: string,
  ): Promise<MgaPayableSourceItem>;
  set(
    database: MgaPayableTransaction,
    context: AuthorizedRequestContext,
    policyId: string,
    input: MgaPayableStateRequest,
    logger: AppLogger,
    changedAt: Date,
  ): Promise<void>;
  sync(
    database: MgaPayableTransaction,
    context: AuthorizedRequestContext,
    policyId: string,
    paid: boolean,
    logger: AppLogger,
    changedAt: Date,
  ): Promise<MgaPaySheetPlacementResult>;
}

export class MgaPayableStateConflictError extends Error {
  constructor() {
    super("MGA payable state cannot be changed");
    this.name = "MgaPayableStateConflictError";
  }
}

export class MgaPayableStateValidationError extends Error {
  constructor() {
    super("MGA payable state request is invalid");
    this.name = "MgaPayableStateValidationError";
  }
}

const defaultOperations: MgaPayableStateOperations = {
  get: getMgaPayableSource,
  async set(database, context, policyId, input, logger, changedAt) {
    await setMgaPaymentState(
      database,
      context,
      policyId,
      input.status,
      input.reference,
      logger,
      changedAt,
    );
  },
  sync: syncMgaPaymentSheetPlacement,
};

export async function changeMgaPayableState(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  policyId: string,
  rawInput: unknown,
  logger: AppLogger,
  changedAt = new Date(),
  operations: MgaPayableStateOperations = defaultOperations,
): Promise<MgaPayableStateChangeResult> {
  const input = mgaPayableStateRequestSchema.parse(rawInput);
  if (Number.isNaN(changedAt.getTime())) {
    throw new MgaPayableStateValidationError();
  }

  try {
    const result = await database.transaction(async (transaction) => {
      await operations.set(
        transaction,
        context,
        policyId,
        input,
        logger,
        changedAt,
      );
      const placement = await operations.sync(
        transaction,
        context,
        policyId,
        input.status === "paid",
        logger,
        changedAt,
      );
      const source = await operations.get(transaction, context, policyId);
      return { placement, source };
    });
    logger.info("MGA payable transaction committed", {
      actorUserId: context.principal.userId,
      associationCount: result.placement.associationCount,
      component: "mga_payables",
      event: "mga_payable_state_committed",
      policyId,
      status: input.status,
    });
    return result;
  } catch (error) {
    logger.error(
      "MGA payable transaction failed",
      {
        actorUserId: context.principal.userId,
        component: "mga_payables",
        event: "mga_payable_state_failed",
        policyId,
        status: input.status,
      },
      error,
    );
    throw mapMgaPayableStateError(error);
  }
}

function mapMgaPayableStateError(error: unknown): unknown {
  if (
    error instanceof MgaPayableNotFoundError ||
    error instanceof MgaPayableStateConflictError ||
    error instanceof MgaPayableStateValidationError
  ) {
    return error;
  }
  const code = readDatabaseErrorCode(error);
  if (
    code === "P0002" ||
    code === "23503" ||
    code === "23505" ||
    code === "23514" ||
    code === "40001" ||
    code === "55000"
  ) {
    return new MgaPayableStateConflictError();
  }
  if (code === "22004" || code === "22P02") {
    return new MgaPayableStateValidationError();
  }
  return error;
}
