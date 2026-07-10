import { sql } from "drizzle-orm";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import { requireLifecycleAdmin } from "../policies/lifecycle.js";

type PaySheetCloseDatabase = Pick<AuthDatabase, "execute">;

export interface PaySheetCloseResult {
  readonly closed: boolean;
  readonly nextSheetId: string;
  readonly ownerType: "producer" | "sophia";
  readonly periodMonth: number;
  readonly periodYear: number;
  readonly policyCount: number;
}

export class PaySheetCloseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaySheetCloseError";
  }
}

export async function closePaySheet(
  database: PaySheetCloseDatabase,
  context: AuthorizedRequestContext,
  paySheetId: string,
  logger: AppLogger,
): Promise<PaySheetCloseResult> {
  const actorUserId = context.principal.userId;
  try {
    requireLifecycleAdmin(context);
    const result = await database.execute<{ close_result: unknown }>(
      sql`select close_pay_sheet(
        ${paySheetId}::uuid,
        ${actorUserId}::uuid
      ) as close_result`,
    );
    const closeResult = parseCloseResult(result.rows[0]?.close_result);
    logger.info("Pay sheet close applied", {
      actorUserId,
      closed: closeResult.closed,
      component: "pay_sheet",
      event: "pay_sheet_close_succeeded",
      nextSheetId: closeResult.nextSheetId,
      ownerType: closeResult.ownerType,
      paySheetId,
      periodMonth: closeResult.periodMonth,
      periodYear: closeResult.periodYear,
      policyCount: closeResult.policyCount,
    });
    return closeResult;
  } catch (error) {
    logger.error(
      "Pay sheet close failed",
      {
        actorUserId,
        component: "pay_sheet",
        event: "pay_sheet_close_failed",
        paySheetId,
      },
      error,
    );
    throw error;
  }
}

function parseCloseResult(value: unknown): PaySheetCloseResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PaySheetCloseError("Pay-sheet close returned an invalid result");
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.closed !== "boolean" ||
    typeof candidate.nextSheetId !== "string" ||
    !uuidPattern.test(candidate.nextSheetId) ||
    (candidate.ownerType !== "sophia" && candidate.ownerType !== "producer") ||
    !Number.isInteger(candidate.periodMonth) ||
    (candidate.periodMonth as number) < 1 ||
    (candidate.periodMonth as number) > 12 ||
    !Number.isInteger(candidate.periodYear) ||
    (candidate.periodYear as number) < 2000 ||
    (candidate.periodYear as number) > 9999 ||
    !Number.isInteger(candidate.policyCount) ||
    (candidate.policyCount as number) < 0
  ) {
    throw new PaySheetCloseError("Pay-sheet close returned an invalid result");
  }
  return Object.freeze({
    closed: candidate.closed,
    nextSheetId: candidate.nextSheetId,
    ownerType: candidate.ownerType,
    periodMonth: candidate.periodMonth as number,
    periodYear: candidate.periodYear as number,
    policyCount: candidate.policyCount as number,
  });
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
