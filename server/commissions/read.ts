import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  myCommissionsListQuerySchema,
  type MyCommissionsListQuery,
} from "../../shared/my-commissions.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import {
  approvalQueueEntries,
  paySheetPolicies,
  paySheets,
  policies,
  policyTypes,
} from "../db/schema.js";
import {
  calculateProducerPayout,
  loadEffectiveProducerRate,
} from "../pay-sheets/read.js";
import {
  buildPaySheetRateSnapshot,
  parsePaySheetPolicySnapshot,
  parsePaySheetRateSnapshot,
} from "../pay-sheets/snapshots.js";
import { parseDraftSubmissionSnapshot } from "../approval-queue/snapshot.js";
import { requireProducerCommissionOwner } from "./access.js";
import type {
  ProducerCommissionItemSource,
  ProducerCommissionSummarySource,
} from "./projection.js";

const MAX_COMMISSION_ITEMS = 5_000;
export const PRODUCER_PAID_RETENTION_DAYS = 30;

export interface MyCommissionsSourceList {
  items: readonly ProducerCommissionItemSource[];
  query: MyCommissionsListQuery;
  summary: ProducerCommissionSummarySource;
}

export class MyCommissionsBoundsError extends Error {
  constructor() {
    super("My Commissions result exceeds the supported bound");
    this.name = "MyCommissionsBoundsError";
  }
}

export class MyCommissionsConsistencyError extends Error {
  constructor() {
    super("My Commissions data is incomplete or inconsistent");
    this.name = "MyCommissionsConsistencyError";
  }
}

export async function listMyCommissionSources(
  database: Pick<AuthDatabase, "select">,
  context: AuthorizedRequestContext,
  rawQuery: unknown,
  asOf = new Date(),
): Promise<MyCommissionsSourceList> {
  const ownerUserId = requireProducerCommissionOwner(context);
  const query = myCommissionsListQuerySchema.parse(rawQuery);
  requireTimestamp(asOf);
  const asOfDate = asOf.toISOString().slice(0, 10);

  const [closedItems, liveRows, reviewRows, rateRecord] = await Promise.all([
    loadClosedItems(database, ownerUserId, asOf),
    loadLiveRows(database, ownerUserId),
    loadReviewRows(database, ownerUserId),
    loadEffectiveProducerRate(database, ownerUserId, asOfDate),
  ]);
  ensureBound(closedItems.length + liveRows.length + reviewRows.length);

  const currentRate =
    rateRecord === null ? null : buildPaySheetRateSnapshot(rateRecord);
  const liveItems = liveRows.map((row) =>
    buildApprovedItem(
      {
        ...row,
        payout:
          currentRate === null
            ? null
            : calculateProducerPayout(row, currentRate),
      },
      ownerUserId,
      asOf,
    ),
  );
  const reviewItems = await buildReviewItems(
    database,
    reviewRows,
    ownerUserId,
    currentRate,
  );
  const allItems = [...closedItems, ...liveItems, ...reviewItems].filter(
    (item): item is ProducerCommissionItemSource => item !== null,
  );
  const summary = buildSummary(allItems, ownerUserId);
  const search = query.search.toLocaleLowerCase("en-US");
  const visibleItems = allItems
    .filter(
      (item) =>
        search.length === 0 ||
        item.insuredName.toLocaleLowerCase("en-US").includes(search),
    )
    .sort((left, right) => compareItems(left, right, query));

  return { items: visibleItems, query, summary };
}

async function loadClosedItems(
  database: Pick<AuthDatabase, "select">,
  ownerUserId: string,
  asOf: Date,
): Promise<ProducerCommissionItemSource[]> {
  const rows = await database
    .select({
      frozenPolicySnapshot: paySheetPolicies.frozenPolicySnapshot,
      frozenRateSnapshot: paySheetPolicies.frozenRateSnapshot,
      policyId: paySheetPolicies.policyId,
      receivedAt: policies.producerCommissionReceivedAt,
    })
    .from(paySheetPolicies)
    .innerJoin(paySheets, eq(paySheets.id, paySheetPolicies.paySheetId))
    .innerJoin(policies, eq(policies.id, paySheetPolicies.policyId))
    .where(
      and(
        eq(paySheets.ownerType, "producer"),
        eq(paySheets.ownerUserId, ownerUserId),
        eq(paySheets.status, "closed"),
        isNull(policies.deletedAt),
      ),
    )
    .orderBy(asc(paySheetPolicies.id))
    .limit(MAX_COMMISSION_ITEMS + 1);
  ensureBound(rows.length);

  return rows
    .map((row): ProducerCommissionItemSource | null => {
      const snapshot = parsePaySheetPolicySnapshot(row.frozenPolicySnapshot);
      parsePaySheetRateSnapshot(row.frozenRateSnapshot);
      if (
        snapshot.policyId !== row.policyId ||
        snapshot.producerUserId !== ownerUserId ||
        (snapshot.kayleeSplit !== "book" && snapshot.kayleeSplit !== "house")
      ) {
        throw new MyCommissionsConsistencyError();
      }
      if (row.receivedAt !== null && !isWithinPaidWindow(row.receivedAt, asOf)) {
        return null;
      }
      return {
        accountGroup: snapshot.kayleeSplit,
        estimate: false,
        id: row.policyId,
        insuredName: snapshot.insuredName,
        ownerUserId,
        payout: snapshot.producerPayout,
        policyType: snapshot.policyTypeName,
        receivedAt: row.receivedAt,
        section: row.receivedAt === null ? "owed" : "paid",
        status: row.receivedAt === null ? "awaiting_payment" : "received",
        transactionType: snapshot.transactionType,
      };
    })
    .filter((item): item is ProducerCommissionItemSource => item !== null);
}

async function loadLiveRows(
  database: Pick<AuthDatabase, "select">,
  ownerUserId: string,
) {
  const rows = await database
    .select({
      accountGroup: policies.kayleeSplit,
      brokerFee: policies.brokerFee,
      commissionAmount: policies.commissionAmount,
      id: policies.id,
      insuredName: policies.insuredName,
      policyType: policyTypes.name,
      receivedAt: policies.producerCommissionReceivedAt,
      transactionType: policies.transactionType,
    })
    .from(policies)
    .innerJoin(policyTypes, eq(policyTypes.id, policies.policyTypeId))
    .where(
      and(
        eq(policies.producerUserId, ownerUserId),
        isNull(policies.deletedAt),
        inArray(policies.kayleeSplit, ["book", "house"]),
        sql`not exists (
          select 1
          from pay_sheet_policies mc_closed_association
          inner join pay_sheets mc_closed_sheet
            on mc_closed_sheet.id = mc_closed_association.pay_sheet_id
          where mc_closed_association.policy_id = ${policies.id}
            and mc_closed_sheet.owner_type = 'producer'
            and mc_closed_sheet.status = 'closed'
        )`,
      ),
    )
    .orderBy(asc(policies.id))
    .limit(MAX_COMMISSION_ITEMS + 1);
  ensureBound(rows.length);
  return rows;
}

async function loadReviewRows(
  database: Pick<AuthDatabase, "select">,
  ownerUserId: string,
) {
  const rows = await database
    .select({
      id: approvalQueueEntries.id,
      submittedPayload: approvalQueueEntries.submittedPayload,
    })
    .from(approvalQueueEntries)
    .where(
      and(
        eq(approvalQueueEntries.status, "pending"),
        isNull(approvalQueueEntries.deletedAt),
        sql`${approvalQueueEntries.submittedPayload} ->> 'producerUserId' = ${ownerUserId}`,
      ),
    )
    .orderBy(asc(approvalQueueEntries.id))
    .limit(MAX_COMMISSION_ITEMS + 1);
  ensureBound(rows.length);
  return rows;
}

async function buildReviewItems(
  database: Pick<AuthDatabase, "select">,
  rows: Awaited<ReturnType<typeof loadReviewRows>>,
  ownerUserId: string,
  currentRate: ReturnType<typeof buildPaySheetRateSnapshot> | null,
): Promise<ProducerCommissionItemSource[]> {
  const snapshots = rows.map((row) => ({
    id: row.id,
    snapshot: parseDraftSubmissionSnapshot(row.submittedPayload),
  }));
  for (const { snapshot } of snapshots) {
    if (
      snapshot.producerUserId !== ownerUserId ||
      (snapshot.kayleeSplit !== "book" && snapshot.kayleeSplit !== "house")
    ) {
      throw new MyCommissionsConsistencyError();
    }
  }
  const policyTypeIds = [...new Set(snapshots.map(({ snapshot }) => snapshot.policyTypeId))];
  const policyTypeRows =
    policyTypeIds.length === 0
      ? []
      : await database
          .select({ id: policyTypes.id, name: policyTypes.name })
          .from(policyTypes)
          .where(inArray(policyTypes.id, policyTypeIds));
  const policyTypeById = new Map(
    policyTypeRows.map((policyType) => [policyType.id, policyType.name]),
  );

  return snapshots.map(({ id, snapshot }) => {
    const policyType = policyTypeById.get(snapshot.policyTypeId);
    if (policyType === undefined) {
      throw new MyCommissionsConsistencyError();
    }
    return {
      accountGroup: snapshot.kayleeSplit as "book" | "house",
      estimate: true,
      id,
      insuredName: snapshot.insuredName,
      ownerUserId,
      payout:
        currentRate === null
          ? null
          : calculateProducerPayout(snapshot, currentRate),
      policyType,
      receivedAt: null,
      section: "in_review",
      status: "pending_approval",
      transactionType: snapshot.transactionType,
    };
  });
}

function buildApprovedItem(
  row: Awaited<ReturnType<typeof loadLiveRows>>[number] & {
    payout: string | null;
  },
  ownerUserId: string,
  asOf: Date,
): ProducerCommissionItemSource | null {
  const accountGroup = row.accountGroup;
  if (accountGroup !== "book" && accountGroup !== "house") {
    throw new MyCommissionsConsistencyError();
  }
  if (row.receivedAt !== null && !isWithinPaidWindow(row.receivedAt, asOf)) {
    return null;
  }
  return {
    accountGroup,
    estimate: false,
    id: row.id,
    insuredName: row.insuredName,
    ownerUserId,
    payout: row.payout,
    policyType: row.policyType,
    receivedAt: row.receivedAt,
    section: row.receivedAt === null ? "owed" : "paid",
    status: row.receivedAt === null ? "awaiting_payment" : "received",
    transactionType: row.transactionType,
  };
}

function buildSummary(
  items: readonly ProducerCommissionItemSource[],
  ownerUserId: string,
): ProducerCommissionSummarySource {
  const owed = items.filter((item) => item.section === "owed");
  const paid = items.filter((item) => item.section === "paid");
  return {
    inReviewCount: items.filter((item) => item.section === "in_review").length,
    owedAmount: sumPayouts(owed),
    owedCount: owed.length,
    ownerUserId,
    paidLast30DaysAmount: sumPayouts(paid),
    paidLast30DaysCount: paid.length,
  };
}

function sumPayouts(items: readonly ProducerCommissionItemSource[]): string | null {
  if (items.some((item) => item.payout === null)) {
    return null;
  }
  return centsToMoney(
    items.reduce((sum, item) => sum + moneyToCents(item.payout!), 0n),
  );
}

function isWithinPaidWindow(receivedAt: Date, asOf: Date): boolean {
  const cutoff =
    asOf.getTime() - PRODUCER_PAID_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
  return receivedAt.getTime() >= cutoff;
}

function compareItems(
  left: ProducerCommissionItemSource,
  right: ProducerCommissionItemSource,
  query: MyCommissionsListQuery,
): number {
  const sectionDifference = sectionOrder(left.section) - sectionOrder(right.section);
  if (sectionDifference !== 0) {
    return sectionDifference;
  }
  if (query.sort === "account") {
    return (
      accountOrder(left.accountGroup) - accountOrder(right.accountGroup) ||
      compareText(left.policyType, right.policyType) ||
      compareText(left.insuredName, right.insuredName) ||
      left.id.localeCompare(right.id)
    );
  }
  if (left.section === "paid" && query.search.length === 0) {
    const dateDifference =
      (right.receivedAt?.getTime() ?? 0) - (left.receivedAt?.getTime() ?? 0);
    if (dateDifference !== 0) {
      return dateDifference;
    }
  }
  return compareText(left.insuredName, right.insuredName) || left.id.localeCompare(right.id);
}

function sectionOrder(section: ProducerCommissionItemSource["section"]): number {
  return section === "owed" ? 0 : section === "in_review" ? 1 : 2;
}

function accountOrder(accountGroup: "book" | "house"): number {
  return accountGroup === "book" ? 0 : 1;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en-US", { sensitivity: "base" });
}

function moneyToCents(value: string): bigint {
  const match = /^(0|[1-9][0-9]*)\.([0-9]{2})$/.exec(value);
  if (match === null) {
    throw new MyCommissionsConsistencyError();
  }
  return BigInt(match[1]!) * 100n + BigInt(match[2]!);
}

function centsToMoney(value: bigint): string {
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

function requireTimestamp(value: Date): void {
  if (Number.isNaN(value.getTime())) {
    throw new MyCommissionsConsistencyError();
  }
}

function ensureBound(count: number): void {
  if (count > MAX_COMMISSION_ITEMS) {
    throw new MyCommissionsBoundsError();
  }
}
