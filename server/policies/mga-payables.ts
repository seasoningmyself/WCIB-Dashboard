import { and, asc, eq, getTableColumns, isNull } from "drizzle-orm";
import {
  mgaPayableItemSchema,
  mgaPayableListQuerySchema,
  type MgaPayableFilter,
  type MgaPayableItem,
  type MgaPayableListResponse,
  type MgaPayableTotals,
} from "../../shared/mga-payables.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { inActiveBusinessGeneration } from "../db/business-state.js";
import {
  mgaPayments,
  mgas,
  policies,
  policyTypes,
  staffProfiles,
  type PolicyRecord,
} from "../db/schema.js";
import { requirePolicyLedgerAdmin } from "./ledger-access.js";
import { projectAdminPolicy } from "./projection.js";

export const MAX_MGA_PAYABLE_SOURCE_ROWS = 5_000;

export interface MgaPayableSourcePayment {
  paidAt: Date | null;
  policyId: string;
  reference: string | null;
  status: "paid" | "unpaid";
}

export interface MgaPayableSourceItem {
  labels: {
    mgaName: string;
    policyTypeName: string;
    producerDisplayName: string | null;
  };
  payment: MgaPayableSourcePayment | null;
  policy: PolicyRecord;
}

export interface MgaPayableSourceList {
  items: readonly MgaPayableSourceItem[];
  status: MgaPayableFilter;
}

export class MgaPayableBoundsError extends Error {
  constructor() {
    super("MGA payable source exceeds the supported bound");
    this.name = "MgaPayableBoundsError";
  }
}

export class MgaPayableConsistencyError extends Error {
  constructor() {
    super("MGA payable state is inconsistent");
    this.name = "MgaPayableConsistencyError";
  }
}

export class MgaPayableNotFoundError extends Error {
  constructor() {
    super("MGA payable policy was not found");
    this.name = "MgaPayableNotFoundError";
  }
}

export async function listMgaPayableSources(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  rawQuery: unknown,
): Promise<MgaPayableSourceList> {
  requirePolicyLedgerAdmin(context);
  const { status } = mgaPayableListQuerySchema.parse(rawQuery);
  const rows = await baseMgaPayableQuery(database)
    .where(
      and(
        isNull(policies.deletedAt),
        inActiveBusinessGeneration(policies.businessGenerationId),
      ),
    )
    .orderBy(asc(mgas.name), asc(policies.insuredName), asc(policies.id))
    .limit(MAX_MGA_PAYABLE_SOURCE_ROWS + 1);
  if (rows.length > MAX_MGA_PAYABLE_SOURCE_ROWS) {
    throw new MgaPayableBoundsError();
  }
  return { items: rows.map(mapMgaPayableRow), status };
}

export async function getMgaPayableSource(
  database: Pick<AuthDatabase, "select">,
  context: AuthorizedRequestContext,
  policyId: string,
): Promise<MgaPayableSourceItem> {
  requirePolicyLedgerAdmin(context);
  const rows = await baseMgaPayableQuery(database)
    .where(
      and(
        eq(policies.id, policyId),
        isNull(policies.deletedAt),
        inActiveBusinessGeneration(policies.businessGenerationId),
      ),
    )
    .limit(1);
  if (rows[0] === undefined) {
    throw new MgaPayableNotFoundError();
  }
  return mapMgaPayableRow(rows[0]);
}

export function projectAdminMgaPayable(
  source: Readonly<MgaPayableSourceItem>,
  context: AuthorizedRequestContext,
): MgaPayableItem | null {
  const policy = projectAdminPolicy(source.policy, context);
  if (policy === null) {
    return null;
  }
  const payment = requireConsistentPayment(source);
  return mgaPayableItemSchema.parse({
    accountAssignment: policy.accountAssignment,
    approvedAt: policy.approvedAt,
    insuredName: policy.insuredName,
    kayleeSplit: policy.kayleeSplit,
    mgaId: policy.mgaId,
    mgaName: source.labels.mgaName,
    netDue: policy.netDue,
    overridden: policy.overridden,
    paidAt: payment.paidAt,
    paymentReference: payment.reference,
    policyId: policy.id,
    policyNumber: policy.policyNumber,
    policyTypeName: source.labels.policyTypeName,
    producerDisplayName: source.labels.producerDisplayName,
    producerUserId: policy.producerUserId,
    status: payment.status,
    transactionType: policy.transactionType,
  });
}

export function buildMgaPayableListResponse(
  items: readonly MgaPayableItem[],
  status: MgaPayableFilter,
): MgaPayableListResponse {
  const groups = new Map<
    string,
    { items: MgaPayableItem[]; mgaName: string }
  >();
  for (const item of items) {
    const existing = groups.get(item.mgaId);
    if (existing !== undefined && existing.mgaName !== item.mgaName) {
      throw new MgaPayableConsistencyError();
    }
    const group = existing ?? { items: [], mgaName: item.mgaName };
    group.items.push(item);
    groups.set(item.mgaId, group);
  }

  const sortedGroups = [...groups.entries()].sort(
    ([leftId, left], [rightId, right]) =>
      compareText(left.mgaName, right.mgaName) ||
      leftId.localeCompare(rightId),
  );
  return {
    groups: sortedGroups.flatMap(([mgaId, group]) => {
      const allItems = [...group.items].sort(
        (left, right) =>
          compareText(left.insuredName, right.insuredName) ||
          left.policyId.localeCompare(right.policyId),
      );
      const visibleItems =
        status === "all"
          ? allItems
          : allItems.filter((item) => item.status === status);
      return visibleItems.length === 0
        ? []
        : [
            {
              items: visibleItems,
              mgaId,
              mgaName: group.mgaName,
              totals: calculateMgaPayableTotals(allItems),
            },
          ];
    }),
    status,
    summary: calculateMgaPayableTotals(items),
  };
}

export function calculateMgaPayableTotals(
  items: readonly MgaPayableItem[],
): MgaPayableTotals {
  let outstanding = 0n;
  let paid = 0n;
  let paidCount = 0;
  for (const item of items) {
    const cents = moneyToCents(item.netDue);
    if (item.status === "paid") {
      paid += cents;
      paidCount += 1;
    } else {
      outstanding += cents;
    }
  }
  return {
    outstandingAmount: centsToMoney(outstanding),
    paidAmount: centsToMoney(paid),
    paidCount,
    totalCount: items.length,
    unpaidCount: items.length - paidCount,
  };
}

function baseMgaPayableQuery(database: Pick<AuthDatabase, "select">) {
  return database
    .select({
      ...getTableColumns(policies),
      mgaName: mgas.name,
      paymentId: mgaPayments.id,
      paymentPaidAt: mgaPayments.paidAt,
      paymentPolicyId: mgaPayments.policyId,
      paymentReference: mgaPayments.reference,
      paymentStatus: mgaPayments.status,
      policyTypeName: policyTypes.name,
      producerDisplayName: staffProfiles.displayName,
    })
    .from(policies)
    .innerJoin(mgas, eq(mgas.id, policies.mgaId))
    .innerJoin(policyTypes, eq(policyTypes.id, policies.policyTypeId))
    .leftJoin(
      mgaPayments,
      and(
        eq(mgaPayments.policyId, policies.id),
        inActiveBusinessGeneration(mgaPayments.businessGenerationId),
      ),
    )
    .leftJoin(staffProfiles, eq(staffProfiles.userId, policies.producerUserId));
}

function mapMgaPayableRow(
  row: Awaited<
    ReturnType<ReturnType<typeof baseMgaPayableQuery>["limit"]>
  >[number],
): MgaPayableSourceItem {
  const {
    mgaName,
    paymentId,
    paymentPaidAt,
    paymentPolicyId,
    paymentReference,
    paymentStatus,
    policyTypeName,
    producerDisplayName,
    ...policy
  } = row;
  return {
    labels: { mgaName, policyTypeName, producerDisplayName },
    payment:
      paymentId === null
        ? null
        : {
            paidAt: paymentPaidAt,
            policyId: paymentPolicyId!,
            reference: paymentReference,
            status: paymentStatus!,
          },
    policy,
  };
}

function requireConsistentPayment(source: MgaPayableSourceItem): {
  paidAt: Date | null;
  reference: string | null;
  status: "paid" | "unpaid";
} {
  const { payment, policy } = source;
  if (payment === null) {
    if (
      policy.mgaPaid ||
      policy.mgaPaidAt !== null ||
      policy.mgaPayReference !== null
    ) {
      throw new MgaPayableConsistencyError();
    }
    return { paidAt: null, reference: null, status: "unpaid" };
  }

  if (
    payment.policyId !== policy.id ||
    (payment.status === "paid") !== policy.mgaPaid ||
    payment.reference !== policy.mgaPayReference ||
    !datesEqual(payment.paidAt, policy.mgaPaidAt)
  ) {
    throw new MgaPayableConsistencyError();
  }
  return payment;
}

function datesEqual(left: Date | null, right: Date | null): boolean {
  return left === null || right === null
    ? left === right
    : left.getTime() === right.getTime();
}

function moneyToCents(value: string): bigint {
  const match = /^(0|[1-9][0-9]*)\.([0-9]{2})$/.exec(value);
  if (match === null) {
    throw new MgaPayableBoundsError();
  }
  return BigInt(match[1]!) * 100n + BigInt(match[2]!);
}

function centsToMoney(value: bigint): string {
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en-US", { sensitivity: "base" });
}
