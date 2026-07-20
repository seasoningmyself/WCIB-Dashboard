import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gte,
  isNotNull,
  isNull,
  lt,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { MAX_DELETED_POLICY_ITEMS } from "../../shared/policy-deletions.js";
import {
  policyLedgerListQuerySchema,
  type PolicyLedgerDuplicate,
  type PolicyLedgerLabels,
  type PolicyLedgerListQuery,
  type PolicyLedgerTotals,
} from "../../shared/policy-ledger.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { inActiveBusinessGeneration } from "../db/business-state.js";
import {
  carriers,
  mgas,
  officeLocations,
  policies,
  policyTypes,
  users,
  type PolicyRecord,
} from "../db/schema.js";
import { requirePolicyLedgerAdmin } from "./ledger-access.js";
import { resolveProducerPayouts } from "../pay-sheets/read.js";

export const MAX_POLICY_LEDGER_SOURCE_ROWS = 5_000;

const producerUsers = alias(users, "ledger_producer_users");
const submitterUsers = alias(users, "ledger_submitter_users");

export interface PolicyLedgerSourceItem {
  duplicate: PolicyLedgerDuplicate;
  labels: PolicyLedgerLabels;
  policy: PolicyRecord;
}

export interface PolicyFinancialSplit {
  producerPayout: string;
  sophiaRetained: string;
}

export type IpfsWorkQueueSourceItem = Omit<
  PolicyLedgerSourceItem,
  "duplicate"
> & PolicyFinancialSplit;

export interface DeletedPolicyLedgerSourceItem {
  labels: PolicyLedgerLabels;
  policy: PolicyRecord;
}

export interface PolicyLedgerSourceList {
  filteredTotal: number;
  hasMore: boolean;
  items: readonly PolicyLedgerSourceItem[];
  limit: number;
  month: string;
  offset: number;
  total: number;
  totals: PolicyLedgerTotals;
}

export class PolicyLedgerNotFoundError extends Error {
  constructor() {
    super("Policy ledger item was not found");
    this.name = "PolicyLedgerNotFoundError";
  }
}

export class PolicyLedgerBoundsError extends Error {
  constructor() {
    super("Policy ledger period exceeds the supported bound");
    this.name = "PolicyLedgerBoundsError";
  }
}

export async function listPolicyLedger(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  rawQuery: unknown,
  now = new Date(),
): Promise<PolicyLedgerSourceList> {
  requirePolicyLedgerAdmin(context);
  const parsed = policyLedgerListQuerySchema.parse(rawQuery);
  const month = parsed.month ?? formatLedgerMonth(now);
  const query = normalizeQuery(parsed);
  const rows = await loadPolicyRows(database, month);
  const payoutByPolicyId = await resolveProducerPayouts(
    database,
    rows.map(({ policy }) => policy),
    formatRateDate(now),
  );
  const duplicateMap = classifyLedgerDuplicates(rows);
  const withDuplicates = rows.map((row) => ({
    ...row,
    duplicate: duplicateMap.get(row.policy.id) ?? null,
  }));
  const filtered = filterLedgerRows(withDuplicates, query);
  const sorted = sortLedgerRows(filtered, query);
  const items = sorted.slice(query.offset, query.offset + query.limit);

  return {
    filteredTotal: filtered.length,
    hasMore: query.offset + items.length < filtered.length,
    items,
    limit: query.limit,
    month,
    offset: query.offset,
    total: rows.length,
    totals: calculateLedgerTotals(filtered, payoutByPolicyId),
  };
}

export async function getPolicyLedgerItem(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  policyId: string,
): Promise<PolicyLedgerSourceItem> {
  requirePolicyLedgerAdmin(context);
  const target = await loadPolicyRow(database, policyId);
  if (target === undefined) {
    throw new PolicyLedgerNotFoundError();
  }
  const month = target.policy.approvedAt.toISOString().slice(0, 7);
  const periodRows = await loadPolicyRows(database, month);
  const duplicateMap = classifyLedgerDuplicates(periodRows);
  return {
    ...target,
    duplicate: duplicateMap.get(policyId) ?? null,
  };
}

export async function listDeletedPolicyLedgerItems(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
): Promise<readonly DeletedPolicyLedgerSourceItem[]> {
  requirePolicyLedgerAdmin(context);
  const rows = await basePolicyQuery(database)
    .where(
      and(
        isNotNull(policies.deletedAt),
        inActiveBusinessGeneration(policies.businessGenerationId),
      ),
    )
    .orderBy(desc(policies.deletedAt), asc(policies.id))
    .limit(MAX_DELETED_POLICY_ITEMS + 1);
  if (rows.length > MAX_DELETED_POLICY_ITEMS) {
    throw new PolicyLedgerBoundsError();
  }
  return rows.map(mapPolicyRow);
}

export async function getDeletedPolicyLedgerItem(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  policyId: string,
): Promise<DeletedPolicyLedgerSourceItem> {
  requirePolicyLedgerAdmin(context);
  const rows = await basePolicyQuery(database)
    .where(
      and(
        eq(policies.id, policyId),
        isNotNull(policies.deletedAt),
        inActiveBusinessGeneration(policies.businessGenerationId),
      ),
    )
    .limit(1);
  if (rows[0] === undefined) {
    throw new PolicyLedgerNotFoundError();
  }
  return mapPolicyRow(rows[0]);
}

export async function listIpfsWorkQueueSources(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  asOf = new Date(),
): Promise<readonly IpfsWorkQueueSourceItem[]> {
  requirePolicyLedgerAdmin(context);
  const rows = await basePolicyQuery(database)
    .where(
      and(
        eq(policies.paymentMode, "deposit"),
        eq(policies.ipfsFinanced, "yes"),
        eq(policies.ipfsManual, false),
        eq(policies.ipfsPushed, false),
        isNull(policies.deletedAt),
        inActiveBusinessGeneration(policies.businessGenerationId),
      ),
    )
    .orderBy(asc(policies.approvedAt), asc(policies.id))
    .limit(MAX_POLICY_LEDGER_SOURCE_ROWS + 1);
  if (rows.length > MAX_POLICY_LEDGER_SOURCE_ROWS) {
    throw new PolicyLedgerBoundsError();
  }
  const sources = rows.map(mapPolicyRow);
  const payoutByPolicyId = await resolveProducerPayouts(
    database,
    sources.map(({ policy }) => policy),
    formatRateDate(asOf),
  );
  return sources.map((source) => ({
    ...source,
    ...calculatePolicyFinancialSplit(source.policy, payoutByPolicyId),
  }));
}

export function normalizeLedgerSearch(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

export function classifyLedgerDuplicates(
  rows: readonly Omit<PolicyLedgerSourceItem, "duplicate">[],
): ReadonlyMap<string, NonNullable<PolicyLedgerDuplicate>> {
  const groups = new Map<string, typeof rows[number][]>();
  for (const row of rows) {
    const insured = normalizeLedgerSearch(row.policy.insuredName);
    const policyNumber = normalizeLedgerSearch(row.policy.policyNumber);
    if (insured === "" || policyNumber === "") {
      continue;
    }
    const key = `${insured}\u0000${policyNumber}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const result = new Map<string, NonNullable<PolicyLedgerDuplicate>>();
  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }
    const accountingCounts = new Map<string, number>();
    for (const row of group) {
      const key = [
        row.policy.basePremium,
        row.policy.brokerFee,
        row.policy.amountPaid,
      ].join("/");
      accountingCounts.set(key, (accountingCounts.get(key) ?? 0) + 1);
    }
    for (const row of group) {
      const accountingKey = [
        row.policy.basePremium,
        row.policy.brokerFee,
        row.policy.amountPaid,
      ].join("/");
      result.set(row.policy.id, {
        count: group.length,
        kind:
          (accountingCounts.get(accountingKey) ?? 0) >= 2
            ? "likely"
            : "possible",
      });
    }
  }
  return result;
}

export function sortLedgerRows(
  rows: readonly PolicyLedgerSourceItem[],
  query: NormalizedPolicyLedgerQuery,
): PolicyLedgerSourceItem[] {
  const direction = query.direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const primary = comparePrimary(left, right, query.sort) * direction;
    if (primary !== 0) {
      return primary;
    }
    const insured = compareText(
      left.policy.insuredName,
      right.policy.insuredName,
    );
    return insured !== 0
      ? insured
      : left.policy.id.localeCompare(right.policy.id);
  });
}

export function calculateLedgerTotals(
  rows: readonly PolicyLedgerSourceItem[],
  payoutByPolicyId: ReadonlyMap<string, string>,
): PolicyLedgerTotals {
  let amountPaid = 0n;
  let brokerFee = 0n;
  let commissionAmount = 0n;
  let producerPayout = 0n;
  let sophiaRetained = 0n;

  for (const { policy } of rows) {
    const paid = moneyToCents(policy.amountPaid);
    const broker = moneyToCents(policy.brokerFee);
    const commission = moneyToCents(policy.commissionAmount);
    const revenue = broker + commission;
    const payout = payoutByPolicyId.get(policy.id);
    if (payout === undefined) {
      throw new PolicyLedgerBoundsError();
    }
    const producerShare = moneyToCents(payout);
    amountPaid += paid;
    brokerFee += broker;
    commissionAmount += commission;
    producerPayout += producerShare;
    sophiaRetained += revenue - producerShare;
  }

  return {
    agencyRevenue: centsToMoney(brokerFee + commissionAmount),
    amountPaid: centsToMoney(amountPaid),
    brokerFee: centsToMoney(brokerFee),
    commissionAmount: centsToMoney(commissionAmount),
    producerPayout: centsToMoney(producerPayout),
    sophiaRetained: centsToMoney(sophiaRetained),
  };
}

interface NormalizedPolicyLedgerQuery extends PolicyLedgerListQuery {
  direction: "asc" | "desc";
}

function normalizeQuery(
  query: PolicyLedgerListQuery,
): NormalizedPolicyLedgerQuery {
  return {
    ...query,
    direction: query.direction ?? (query.sort === "date" ? "desc" : "asc"),
    search: normalizeLedgerSearch(query.search),
  };
}

function filterLedgerRows(
  rows: readonly PolicyLedgerSourceItem[],
  query: NormalizedPolicyLedgerQuery,
): PolicyLedgerSourceItem[] {
  return rows.filter((row) => {
    if (!matchesLedgerSearch(row, query.search)) {
      return false;
    }
    if (query.duplicates === "only" && row.duplicate === null) {
      return false;
    }
    if (query.finance === "financed") {
      return row.policy.paymentMode === "deposit";
    }
    if (query.finance === "ipfs_pending") {
      return (
        row.policy.paymentMode === "deposit" &&
        row.policy.ipfsFinanced === "yes" &&
        !row.policy.ipfsPushed
      );
    }
    if (query.finance === "ipfs_completed") {
      return (
        row.policy.paymentMode === "deposit" &&
        row.policy.ipfsFinanced === "yes" &&
        row.policy.ipfsPushed
      );
    }
    return true;
  });
}

export function matchesLedgerSearch(
  row: PolicyLedgerSourceItem,
  search: string,
): boolean {
  const normalized = normalizeLedgerSearch(search);
  if (normalized === "") return true;
  return [
    row.policy.insuredName,
    row.policy.policyNumber,
    row.labels.carrierName,
    row.labels.mgaName,
  ].some((value) => normalizeLedgerSearch(value).includes(normalized));
}

function comparePrimary(
  left: PolicyLedgerSourceItem,
  right: PolicyLedgerSourceItem,
  sort: PolicyLedgerListQuery["sort"],
): number {
  if (sort === "date") {
    return left.policy.approvedAt.getTime() - right.policy.approvedAt.getTime();
  }
  if (sort === "insured") {
    return compareText(left.policy.insuredName, right.policy.insuredName);
  }
  if (sort === "mga") {
    return compareText(left.labels.mgaName, right.labels.mgaName);
  }
  if (sort === "transaction") {
    return compareText(
      left.policy.transactionType,
      right.policy.transactionType,
    );
  }
  if (sort === "submitter") {
    return compareText(
      left.labels.submitterDisplayName,
      right.labels.submitterDisplayName,
    );
  }
  return compareText(accountSortKey(left), accountSortKey(right));
}

function accountSortKey(item: PolicyLedgerSourceItem): string {
  if (item.policy.kayleeSplit === "none") {
    return "0 house";
  }
  const producer = item.labels.producerDisplayName ?? "";
  return item.policy.kayleeSplit === "book"
    ? `1 ${producer} book`
    : `2 ${producer} first year`;
}

function compareText(left: string, right: string): number {
  return normalizeLedgerSearch(left).localeCompare(
    normalizeLedgerSearch(right),
    "en-US",
  );
}

function formatLedgerMonth(now: Date): string {
  if (Number.isNaN(now.getTime())) {
    throw new PolicyLedgerBoundsError();
  }
  return now.toISOString().slice(0, 7);
}

function formatRateDate(now: Date): string {
  if (Number.isNaN(now.getTime())) {
    throw new PolicyLedgerBoundsError();
  }
  return now.toISOString().slice(0, 10);
}

function monthRange(month: string): { end: Date; start: Date } {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  return {
    end: new Date(Date.UTC(year, monthIndex + 1, 1)),
    start: new Date(Date.UTC(year, monthIndex, 1)),
  };
}

async function loadPolicyRows(
  database: AuthDatabase,
  month: string,
): Promise<Omit<PolicyLedgerSourceItem, "duplicate">[]> {
  const range = monthRange(month);
  const rows = await basePolicyQuery(database)
    .where(
      and(
        isNull(policies.deletedAt),
        inActiveBusinessGeneration(policies.businessGenerationId),
        gte(policies.approvedAt, range.start),
        lt(policies.approvedAt, range.end),
      ),
    )
    .orderBy(desc(policies.approvedAt), asc(policies.id))
    .limit(MAX_POLICY_LEDGER_SOURCE_ROWS + 1);
  if (rows.length > MAX_POLICY_LEDGER_SOURCE_ROWS) {
    throw new PolicyLedgerBoundsError();
  }
  return rows.map(mapPolicyRow);
}

async function loadPolicyRow(
  database: AuthDatabase,
  policyId: string,
): Promise<Omit<PolicyLedgerSourceItem, "duplicate"> | undefined> {
  const rows = await basePolicyQuery(database)
    .where(
      and(
        eq(policies.id, policyId),
        isNull(policies.deletedAt),
        inActiveBusinessGeneration(policies.businessGenerationId),
      ),
    )
    .limit(1);
  return rows[0] === undefined ? undefined : mapPolicyRow(rows[0]);
}

function basePolicyQuery(database: AuthDatabase) {
  return database
    .select({
      ...getTableColumns(policies),
      carrierName: carriers.name,
      mgaName: mgas.name,
      officeName: officeLocations.name,
      policyTypeClass: policyTypes.classTag,
      policyTypeName: policyTypes.name,
      producerDisplayName: producerUsers.displayName,
      submitterDisplayName: submitterUsers.displayName,
      submitterEmail: submitterUsers.email,
    })
    .from(policies)
    .innerJoin(carriers, eq(carriers.id, policies.carrierId))
    .innerJoin(mgas, eq(mgas.id, policies.mgaId))
    .innerJoin(officeLocations, eq(officeLocations.id, policies.officeLocationId))
    .innerJoin(policyTypes, eq(policyTypes.id, policies.policyTypeId))
    .leftJoin(
      producerUsers,
      eq(producerUsers.id, policies.producerUserId),
    )
    .innerJoin(submitterUsers, eq(submitterUsers.id, policies.submittedByUserId));
}

function mapPolicyRow(
  row: Awaited<ReturnType<ReturnType<typeof basePolicyQuery>["limit"]>>[number],
): Omit<PolicyLedgerSourceItem, "duplicate"> {
  const {
    carrierName,
    mgaName,
    officeName,
    policyTypeClass,
    policyTypeName,
    producerDisplayName,
    submitterDisplayName,
    submitterEmail,
    ...policy
  } = row;
  return {
    labels: {
      carrierName,
      mgaName,
      officeName,
      policyTypeClass,
      policyTypeName,
      producerDisplayName,
      submitterDisplayName: submitterDisplayName ?? submitterEmail,
    },
    policy,
  };
}

function moneyToCents(value: string): bigint {
  const match = /^(0|[1-9][0-9]*)\.([0-9]{2})$/.exec(value);
  if (match === null) {
    throw new PolicyLedgerBoundsError();
  }
  return BigInt(match[1]!) * 100n + BigInt(match[2]!);
}

function centsToMoney(value: bigint): string {
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

function calculatePolicyFinancialSplit(
  policy: PolicyRecord,
  payoutByPolicyId: ReadonlyMap<string, string>,
): PolicyFinancialSplit {
  const producerPayout = payoutByPolicyId.get(policy.id);
  if (producerPayout === undefined) {
    throw new PolicyLedgerBoundsError();
  }
  const agencyRevenue =
    moneyToCents(policy.brokerFee) + moneyToCents(policy.commissionAmount);
  return {
    producerPayout,
    sophiaRetained: centsToMoney(
      agencyRevenue - moneyToCents(producerPayout),
    ),
  };
}
