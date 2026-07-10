import { sql } from "drizzle-orm";
import type { MgaPaymentStatus } from "../../shared/mga-payments.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import { requireLifecycleAdmin } from "./lifecycle.js";

type MgaPaymentDatabase = Pick<AuthDatabase, "execute">;

export class MgaPaymentStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MgaPaymentStateError";
  }
}

export async function setMgaPaymentState(
  database: MgaPaymentDatabase,
  context: AuthorizedRequestContext,
  policyId: string,
  status: MgaPaymentStatus,
  reference: string | null,
  logger: AppLogger,
  changedAt = new Date(),
): Promise<string> {
  const actorUserId = context.principal.userId;
  try {
    requireLifecycleAdmin(context);
    if (Number.isNaN(changedAt.getTime())) {
      throw new MgaPaymentStateError(
        "A valid MGA payment timestamp is required",
      );
    }
    const result = await database.execute<{ payment_id: string }>(
      sql`select set_mga_payment_state(
        ${policyId}::uuid,
        ${actorUserId}::uuid,
        ${status}::mga_payment_status,
        ${reference}::text,
        ${changedAt}::timestamp with time zone
      ) as payment_id`,
    );
    const paymentId = result.rows[0]?.payment_id;
    if (paymentId === undefined) {
      throw new MgaPaymentStateError("MGA payment mutation returned no ID");
    }
    logger.info("MGA payment state applied", {
      actorUserId,
      component: "mga_payment",
      event: "mga_payment_transition_succeeded",
      paymentId,
      policyId,
      status,
    });
    return paymentId;
  } catch (error) {
    logger.error(
      "MGA payment state failed",
      {
        actorUserId,
        component: "mga_payment",
        event: "mga_payment_transition_failed",
        policyId,
        status,
      },
      error,
    );
    throw error;
  }
}
