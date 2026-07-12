import { and, eq } from "drizzle-orm";
import { myCommissionReceiptRequestSchema } from "../../shared/my-commissions.js";
import { writeAuditEventInDrizzleTransaction } from "../audit/event.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { paySheetPolicies, paySheets, policies } from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import { parsePaySheetPolicySnapshot } from "../pay-sheets/snapshots.js";
import { requireProducerCommissionOwner } from "./access.js";
import type { ProducerCommissionItemSource } from "./projection.js";
import {
  MyCommissionsConsistencyError,
  PRODUCER_PAID_RETENTION_DAYS,
  listMyCommissionSources,
} from "./read.js";

export interface ProducerCommissionReceiptResult {
  changed: boolean;
  source: ProducerCommissionItemSource;
}

export class ProducerCommissionReceiptNotFoundError extends Error {
  constructor() {
    super("Commission item was not found");
    this.name = "ProducerCommissionReceiptNotFoundError";
  }
}

export class ProducerCommissionReceiptValidationError extends Error {
  constructor() {
    super("Commission receipt request is invalid");
    this.name = "ProducerCommissionReceiptValidationError";
  }
}

export async function setProducerCommissionReceipt(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  policyId: string,
  rawInput: unknown,
  logger: AppLogger,
  changedAt = new Date(),
): Promise<ProducerCommissionReceiptResult> {
  const ownerUserId = requireProducerCommissionOwner(context);
  const input = myCommissionReceiptRequestSchema.parse(rawInput);
  if (Number.isNaN(changedAt.getTime())) {
    throw new ProducerCommissionReceiptValidationError();
  }

  try {
    const result = await database.transaction(async (transaction) => {
      const [policy] = await transaction
        .select({
          id: policies.id,
          kayleeSplit: policies.kayleeSplit,
          producerCommissionReceivedAt:
            policies.producerCommissionReceivedAt,
          producerUserId: policies.producerUserId,
        })
        .from(policies)
        .where(eq(policies.id, policyId))
        .limit(1)
        .for("update");
      if (policy === undefined) {
        throw new ProducerCommissionReceiptNotFoundError();
      }

      await requireOwnedCommissionItem(
        transaction,
        policy,
        ownerUserId,
      );
      if (
        policy.producerCommissionReceivedAt !== null &&
        !isWithinProducerAccessWindow(
          policy.producerCommissionReceivedAt,
          changedAt,
        )
      ) {
        throw new ProducerCommissionReceiptNotFoundError();
      }

      const currentlyReceived =
        policy.producerCommissionReceivedAt !== null;
      const changed = currentlyReceived !== input.received;
      if (changed) {
        await transaction
          .update(policies)
          .set({
            producerCommissionReceivedAt: input.received ? changedAt : null,
          })
          .where(eq(policies.id, policy.id));
        await writeAuditEventInDrizzleTransaction(
          transaction,
          context,
          {
            action: input.received
              ? "producer_commission_receipt_marked"
              : "producer_commission_receipt_unmarked",
            after: {
              allowedFields: ["received"],
              source: { received: input.received },
            },
            before: {
              allowedFields: ["received"],
              source: { received: currentlyReceived },
            },
            entityId: policy.id,
            entityType: "policy",
          },
          logger,
        );
      }

      const refreshed = await listMyCommissionSources(
        transaction,
        context,
        {},
        changedAt,
      );
      const source = refreshed.items.find((item) => item.id === policy.id);
      if (source === undefined) {
        throw new MyCommissionsConsistencyError();
      }
      return { changed, source };
    });
    logger.info("Producer commission receipt state applied", {
      actorUserId: ownerUserId,
      changed: result.changed,
      component: "my_commissions",
      event: "producer_commission_receipt_applied",
      policyId,
      received: input.received,
    });
    return result;
  } catch (error) {
    logger.error(
      "Producer commission receipt state failed",
      {
        actorUserId: ownerUserId,
        component: "my_commissions",
        event: "producer_commission_receipt_failed",
        policyId,
        received: input.received,
      },
      error,
    );
    throw error;
  }
}

async function requireOwnedCommissionItem(
  database: Pick<AuthDatabase, "select">,
  policy: {
    id: string;
    kayleeSplit: "book" | "house" | "none";
    producerUserId: string | null;
  },
  ownerUserId: string,
): Promise<void> {
  const closedAssociations = await database
    .select({
      frozenPolicySnapshot: paySheetPolicies.frozenPolicySnapshot,
      ownerUserId: paySheets.ownerUserId,
    })
    .from(paySheetPolicies)
    .innerJoin(paySheets, eq(paySheets.id, paySheetPolicies.paySheetId))
    .where(
      and(
        eq(paySheetPolicies.policyId, policy.id),
        eq(paySheets.ownerType, "producer"),
        eq(paySheets.status, "closed"),
      ),
    )
    .limit(2);

  if (closedAssociations.length > 0) {
    if (closedAssociations.length !== 1) {
      throw new MyCommissionsConsistencyError();
    }
    const association = closedAssociations[0]!;
    const snapshot = parsePaySheetPolicySnapshot(
      association.frozenPolicySnapshot,
    );
    if (
      association.ownerUserId !== ownerUserId ||
      snapshot.policyId !== policy.id ||
      snapshot.producerUserId !== ownerUserId ||
      (snapshot.kayleeSplit !== "book" && snapshot.kayleeSplit !== "house")
    ) {
      throw new ProducerCommissionReceiptNotFoundError();
    }
    return;
  }

  if (
    policy.producerUserId !== ownerUserId ||
    (policy.kayleeSplit !== "book" && policy.kayleeSplit !== "house")
  ) {
    throw new ProducerCommissionReceiptNotFoundError();
  }
}

function isWithinProducerAccessWindow(
  receivedAt: Date,
  asOf: Date,
): boolean {
  const cutoff =
    asOf.getTime() - PRODUCER_PAID_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
  return receivedAt.getTime() >= cutoff;
}
