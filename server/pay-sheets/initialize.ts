import { sql } from "drizzle-orm";
import {
  paySheetBootstrapRequestSchema,
} from "../../shared/pay-sheet-api.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import { requirePolicyLedgerAdmin } from "../policies/ledger-access.js";

type PaySheetInitializationDatabase = Pick<AuthDatabase, "execute">;

export interface PaySheetInitializationResult {
  readonly created: boolean;
  readonly ownerType: "producer" | "sophia";
  readonly paySheetId: string;
  readonly periodMonth: number;
  readonly periodYear: number;
}

export class PaySheetInitializationError extends Error {
  constructor() {
    super("Pay-sheet initialization returned an invalid result");
    this.name = "PaySheetInitializationError";
  }
}

export async function initializeSophiaPaySheet(
  database: PaySheetInitializationDatabase,
  context: AuthorizedRequestContext,
  rawInput: unknown,
  logger: AppLogger,
  openedAt = new Date(),
): Promise<PaySheetInitializationResult> {
  requirePolicyLedgerAdmin(context);
  const input = paySheetBootstrapRequestSchema.parse(rawInput);
  requireTimestamp(openedAt);
  const actorUserId = context.principal.userId;

  try {
    const result = await database.execute<{ initialization: unknown }>(
      sql`select initialize_pay_sheet_owner_chain(
        ${actorUserId}::uuid,
        'sophia'::pay_sheet_owner_type,
        ${input.periodMonth}::integer,
        ${input.periodYear}::integer,
        ${actorUserId}::uuid,
        ${openedAt}::timestamp with time zone
      ) as initialization`,
    );
    const initialization = parseInitialization(result.rows[0]?.initialization);
    logger.info("Pay-sheet owner chain initialized", {
      actorUserId,
      component: "pay_sheets",
      created: initialization.created,
      event: "pay_sheet_initialization_succeeded",
      ownerType: initialization.ownerType,
      paySheetId: initialization.paySheetId,
      periodMonth: initialization.periodMonth,
      periodYear: initialization.periodYear,
    });
    return initialization;
  } catch (error) {
    logger.error(
      "Pay-sheet owner-chain initialization failed",
      {
        actorUserId,
        component: "pay_sheets",
        event: "pay_sheet_initialization_failed",
        periodMonth: input.periodMonth,
        periodYear: input.periodYear,
      },
      error,
    );
    throw error;
  }
}

function parseInitialization(value: unknown): PaySheetInitializationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PaySheetInitializationError();
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.created !== "boolean" ||
    (candidate.ownerType !== "sophia" && candidate.ownerType !== "producer") ||
    typeof candidate.paySheetId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      candidate.paySheetId,
    ) ||
    !Number.isInteger(candidate.periodMonth) ||
    (candidate.periodMonth as number) < 1 ||
    (candidate.periodMonth as number) > 12 ||
    !Number.isInteger(candidate.periodYear) ||
    (candidate.periodYear as number) < 2000 ||
    (candidate.periodYear as number) > 9999
  ) {
    throw new PaySheetInitializationError();
  }
  return Object.freeze({
    created: candidate.created,
    ownerType: candidate.ownerType,
    paySheetId: candidate.paySheetId,
    periodMonth: candidate.periodMonth as number,
    periodYear: candidate.periodYear as number,
  });
}

function requireTimestamp(value: Date): void {
  if (Number.isNaN(value.getTime())) throw new PaySheetInitializationError();
}
