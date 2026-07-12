import {
  myCommissionItemSchema,
  myCommissionsSummarySchema,
  type MyCommissionItem,
  type MyCommissionsSummary,
} from "../../shared/my-commissions.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";

export interface ProducerCommissionItemSource {
  accountGroup: "book" | "house";
  estimate: boolean;
  id: string;
  insuredName: string;
  ownerUserId: string;
  payout: string | null;
  policyType: string;
  receivedAt: Date | null;
  section: "owed" | "in_review" | "paid";
  status: "awaiting_payment" | "pending_approval" | "received";
  transactionType: string;
}

export interface ProducerCommissionSummarySource extends MyCommissionsSummary {
  ownerUserId: string;
}

export const PRODUCER_COMMISSION_RESPONSE_FIELDS = [
  "estimate",
  "id",
  "insuredName",
  "payout",
  "policyType",
  "receivedAt",
  "section",
  "status",
  "transactionType",
] as const satisfies readonly (keyof ProducerCommissionItemSource)[];

export function projectProducerCommissionItem(
  source: Readonly<ProducerCommissionItemSource>,
  context: AuthorizedRequestContext,
): MyCommissionItem | null {
  if (!canReadOwnCommission(context, source.ownerUserId)) {
    return null;
  }
  return myCommissionItemSchema.parse(
    Object.fromEntries(
      PRODUCER_COMMISSION_RESPONSE_FIELDS.map((field) => [field, source[field]]),
    ),
  );
}

export function projectProducerCommissionSummary(
  source: Readonly<ProducerCommissionSummarySource>,
  context: AuthorizedRequestContext,
): MyCommissionsSummary | null {
  if (!canReadOwnCommission(context, source.ownerUserId)) {
    return null;
  }
  return myCommissionsSummarySchema.parse({
    inReviewCount: source.inReviewCount,
    owedAmount: source.owedAmount,
    owedCount: source.owedCount,
    paidLast30DaysAmount: source.paidLast30DaysAmount,
    paidLast30DaysCount: source.paidLast30DaysCount,
  });
}

function canReadOwnCommission(
  context: AuthorizedRequestContext,
  ownerUserId: string,
): boolean {
  const { principal } = context;
  return (
    principal.userActive &&
    principal.staffRole === "producer" &&
    principal.userId === ownerUserId
  );
}
