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

export interface PaySheetCascadeCloseResult {
  readonly cascaded: readonly PaySheetCascadeCloseItem[];
  readonly primary: PaySheetCloseResult;
}

export interface PaySheetCascadeCloseItem {
  readonly close: PaySheetCloseResult;
  readonly paySheetId: string;
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

export async function closePaySheetWithCascade(
  database: PaySheetCloseDatabase,
  context: AuthorizedRequestContext,
  paySheetId: string,
  cascadeProducerSheets: boolean,
  logger: AppLogger,
): Promise<PaySheetCascadeCloseResult> {
  const actorUserId = context.principal.userId;
  try {
    requireLifecycleAdmin(context);
    const result = await database.execute<{ close_result: unknown }>(
      sql`select close_pay_sheet_with_cascade(
        ${paySheetId}::uuid,
        ${actorUserId}::uuid,
        ${cascadeProducerSheets}::boolean
      ) as close_result`,
    );
    const closeResult = parseCascadeCloseResult(result.rows[0]?.close_result);
    logger.info("Pay sheet close set applied", {
      actorUserId,
      cascadeProducerSheets,
      cascadedCount: closeResult.cascaded.length,
      closed: closeResult.primary.closed,
      component: "pay_sheet",
      event: "pay_sheet_cascade_close_succeeded",
      nextSheetId: closeResult.primary.nextSheetId,
      ownerType: closeResult.primary.ownerType,
      paySheetId,
      periodMonth: closeResult.primary.periodMonth,
      periodYear: closeResult.primary.periodYear,
      policyCount: closeResult.primary.policyCount,
    });
    return closeResult;
  } catch (error) {
    logger.error(
      "Pay sheet close set failed",
      {
        actorUserId,
        cascadeProducerSheets,
        component: "pay_sheet",
        event: "pay_sheet_cascade_close_failed",
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

function parseCascadeCloseResult(value: unknown): PaySheetCascadeCloseResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PaySheetCloseError("Pay-sheet cascade close returned an invalid result");
  }
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.cascaded)) {
    throw new PaySheetCloseError("Pay-sheet cascade close returned an invalid result");
  }
  return Object.freeze({
    cascaded: Object.freeze(candidate.cascaded.map(parseCascadeCloseItem)),
    primary: parseCloseResult(candidate.primary),
  });
}

function parseCascadeCloseItem(value: unknown): PaySheetCascadeCloseItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PaySheetCloseError("Pay-sheet cascade item returned an invalid result");
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.paySheetId !== "string" || !uuidPattern.test(candidate.paySheetId)) {
    throw new PaySheetCloseError("Pay-sheet cascade item returned an invalid result");
  }
  return Object.freeze({
    close: parseCloseResult(candidate.close),
    paySheetId: candidate.paySheetId,
  });
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
