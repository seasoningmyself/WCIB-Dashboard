import { and, desc, eq, getTableColumns, lte, type SQL } from "drizzle-orm";
import {
  paySheetCloseResultSchema,
  paySheetAdjustmentViewSchema,
  paySheetDetailSchema,
  paySheetListQuerySchema,
  paySheetPolicyViewSchema,
  paySheetProducerTotalsSchema,
  paySheetSophiaTotalsSchema,
  paySheetSummarySchema,
  type PaySheetAdjustmentView,
  type PaySheetCloseResult as ProjectedPaySheetCloseResult,
  type PaySheetDetail,
  type PaySheetListQuery,
  type PaySheetPolicyView,
  type PaySheetProducerTotals,
  type PaySheetRate,
  type PaySheetSophiaTotals,
  type PaySheetSummary,
} from "../../shared/pay-sheet-api.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import {
  paySheetAdjustments,
  paySheetPolicies,
  paySheets,
  policies,
  policyTypes,
  producerRateHistory,
  staffProfiles,
  users,
  type PaySheetAdjustmentRecord,
  type PaySheetRecord,
  type ProducerRateHistoryRecord,
} from "../db/schema.js";
import { requirePolicyLedgerAdmin } from "../policies/ledger-access.js";
import type { PaySheetCloseResult } from "./close.js";
import { buildPaySheetFrozenTotals } from "./frozen-totals.js";
import {
  buildPaySheetPolicySnapshot,
  buildPaySheetRateSnapshot,
  parsePaySheetPolicySnapshot,
  parsePaySheetRateSnapshot,
} from "./snapshots.js";

const MAX_PAY_SHEET_ROWS = 1_000;

type PaySheetReadDatabase = Pick<AuthDatabase, "select">;

interface PaySheetHeaderSource {
  ownerDisplayName: string;
  ownerEmail: string;
  sheet: PaySheetRecord;
}

interface LivePolicySource {
  addedAt: Date;
  associationId: string;
  approvedAt: Date;
  brokerFee: string;
  commissionAmount: string;
  effectiveDate: string;
  insuredName: string;
  kayleeSplit: "book" | "house" | "none";
  officeLocationId: string;
  policyId: string;
  policyNumber: string;
  policyTypeClass: "Commercial" | "Life-Health" | "Personal";
  policyTypeName: string;
  producerUserId: string | null;
  transactionType: string;
}

interface FrozenPolicySource {
  addedAt: Date;
  associationId: string;
  frozenPolicySnapshot: unknown;
  frozenRateSnapshot: unknown;
}

type PaySheetPolicySource =
  | { kind: "frozen"; value: FrozenPolicySource }
  | { kind: "live"; value: LivePolicySource };

interface AdjustmentSource {
  adjustment: PaySheetAdjustmentRecord;
  policyTypeName: string | null;
  producerDisplayName: string | null;
}

export interface PaySheetSource {
  adjustments: readonly AdjustmentSource[];
  header: PaySheetHeaderSource;
  policies: readonly PaySheetPolicySource[];
  rate: ProducerRateHistoryRecord | null;
}

export interface PaySheetSourceList {
  items: readonly PaySheetSource[];
  query: PaySheetListQuery;
}

export class PaySheetBoundsError extends Error {
  constructor() {
    super("Pay-sheet result exceeds the supported bound");
    this.name = "PaySheetBoundsError";
  }
}

export class PaySheetNotFoundError extends Error {
  constructor() {
    super("Pay sheet was not found");
    this.name = "PaySheetNotFoundError";
  }
}

export class PaySheetReadConsistencyError extends Error {
  constructor() {
    super("Pay-sheet history is incomplete or inconsistent");
    this.name = "PaySheetReadConsistencyError";
  }
}

export async function listPaySheetSources(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  rawQuery: unknown,
  asOf = new Date(),
): Promise<PaySheetSourceList> {
  requirePolicyLedgerAdmin(context);
  const query = paySheetListQuerySchema.parse(rawQuery);
  requireTimestamp(asOf);
  const headers = await loadHeaders(database, query);
  const items: PaySheetSource[] = [];
  for (const header of headers) {
    items.push(await loadSource(database, header, asOf));
  }
  return {
    items: items.sort(compareSources),
    query,
  };
}

export async function getPaySheetSource(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  paySheetId: string,
  asOf = new Date(),
): Promise<PaySheetSource> {
  requirePolicyLedgerAdmin(context);
  requireTimestamp(asOf);
  const [header] = await baseHeaderQuery(database)
    .where(eq(paySheets.id, paySheetId))
    .limit(1);
  if (header === undefined) {
    throw new PaySheetNotFoundError();
  }
  return loadSource(database, mapHeader(header), asOf);
}

export function projectAdminPaySheetSummary(
  source: Readonly<PaySheetSource>,
  context: AuthorizedRequestContext,
): PaySheetSummary | null {
  requirePolicyLedgerAdmin(context);
  const projected = projectSource(source);
  return paySheetSummarySchema.parse(projected.summary);
}

export function projectAdminPaySheetDetail(
  source: Readonly<PaySheetSource>,
  context: AuthorizedRequestContext,
): PaySheetDetail | null {
  requirePolicyLedgerAdmin(context);
  const projected = projectSource(source);
  return paySheetDetailSchema.parse({
    ...projected.summary,
    adjustments: projected.adjustments,
    policies: projected.policies,
  });
}

export function projectAdminPaySheetCloseResult(
  source: Readonly<PaySheetCloseResult>,
  context: AuthorizedRequestContext,
): ProjectedPaySheetCloseResult | null {
  requirePolicyLedgerAdmin(context);
  return paySheetCloseResultSchema.parse({
    closed: source.closed,
    nextSheetId: source.nextSheetId,
    ownerType: source.ownerType,
    periodMonth: source.periodMonth,
    periodYear: source.periodYear,
    policyCount: source.policyCount,
  });
}

export function calculateOpenPaySheetTotals(
  ownerType: "producer" | "sophia",
  policiesForSheet: readonly PaySheetPolicyView[],
  adjustments: readonly PaySheetAdjustmentView[],
): PaySheetProducerTotals | PaySheetSophiaTotals | null {
  if (
    ownerType === "producer" &&
    policiesForSheet.some((policy) => policy.producerPayout === null)
  ) {
    return null;
  }

  let brokerFees = sumMoney(policiesForSheet.map((policy) => policy.brokerFee));
  let commissions = sumMoney(
    policiesForSheet.map((policy) => policy.commissionAmount),
  );
  let directIncome = 0n;
  let producerPayout = sumMoney(
    policiesForSheet.map((policy) => policy.producerPayout ?? "0.00"),
  );
  let sophiaShare = sumMoney(
    policiesForSheet.map((policy) => policy.sophiaShare),
  );

  for (const adjustment of adjustments) {
    const brokerDelta = moneyToCents(adjustment.brokerFeeDelta);
    const commissionDelta = moneyToCents(adjustment.commissionDelta);
    brokerFees += brokerDelta;
    commissions += commissionDelta;
    directIncome += moneyToCents(adjustment.incomeAmount);
    producerPayout += moneyToCents(adjustment.payoutDelta);
    const shareNumerator =
      (brokerDelta + commissionDelta) *
      (adjustment.accountBasis === "own" ? 100n : 75n);
    sophiaShare += roundRatio(shareNumerator, 100n);
  }

  const trustPull = brokerFees + commissions;
  const grandTotalIncome = trustPull + directIncome;
  if (ownerType === "sophia") {
    return paySheetSophiaTotalsSchema.parse({
      brokerFees: centsToMoney(brokerFees),
      commissions: centsToMoney(commissions),
      directCheckAchIncome: centsToMoney(directIncome),
      grandTotalIncome: centsToMoney(grandTotalIncome),
      sophiaAgencyGross: centsToMoney(grandTotalIncome),
      sophiaShare: centsToMoney(sophiaShare),
      sophiaTakeHome: centsToMoney(sophiaShare + directIncome),
      trustPull: centsToMoney(trustPull),
    });
  }
  return paySheetProducerTotalsSchema.parse({
    brokerFees: centsToMoney(brokerFees),
    commissions: centsToMoney(commissions),
    directCheckAchIncome: centsToMoney(directIncome),
    grandTotalIncome: centsToMoney(grandTotalIncome),
    producerPayout: centsToMoney(producerPayout),
    trustPull: centsToMoney(trustPull),
  });
}

function projectSource(source: Readonly<PaySheetSource>): {
  adjustments: PaySheetAdjustmentView[];
  policies: PaySheetPolicyView[];
  summary: PaySheetSummary;
} {
  const { sheet } = source.header;
  const rate = projectRate(source.rate);
  const policiesForSheet = source.policies
    .map((policy) => projectPolicy(policy, sheet.ownerType, rate))
    .sort(comparePolicies);
  const adjustments = source.adjustments
    .map(projectAdjustment)
    .sort(compareAdjustments);
  const closeBlocker =
    sheet.status === "closed"
      ? null
      : policiesForSheet.length === 0
        ? "empty"
        : sheet.ownerType === "producer" && rate === null
          ? "missing_rate"
          : null;
  const totals =
    sheet.status === "closed"
      ? projectFrozenTotals(sheet)
      : calculateOpenPaySheetTotals(sheet.ownerType, policiesForSheet, adjustments);

  const summary = paySheetSummarySchema.parse({
    adjustmentCount: adjustments.length,
    closeBlocker,
    closedAt: sheet.closedAt,
    closedByUserId: sheet.closedByUserId,
    id: sheet.id,
    openedAt: sheet.openedAt,
    ownerDisplayName: source.header.ownerDisplayName,
    ownerType: sheet.ownerType,
    ownerUserId: sheet.ownerUserId,
    periodMonth: sheet.periodMonth,
    periodYear: sheet.periodYear,
    policyCount: policiesForSheet.length,
    status: sheet.status,
    totals,
    updatedAt: sheet.updatedAt,
  });
  return { adjustments, policies: policiesForSheet, summary };
}

function projectPolicy(
  source: PaySheetPolicySource,
  ownerType: "producer" | "sophia",
  currentRate: PaySheetRate | null,
): PaySheetPolicyView {
  if (source.kind === "frozen") {
    const snapshot = parsePaySheetPolicySnapshot(
      source.value.frozenPolicySnapshot,
    );
    const rate =
      source.value.frozenRateSnapshot === null
        ? null
        : parsePaySheetRateSnapshot(source.value.frozenRateSnapshot);
    if (
      (ownerType === "producer" && rate === null) ||
      (ownerType === "sophia" && rate !== null)
    ) {
      throw new PaySheetReadConsistencyError();
    }
    return paySheetPolicyViewSchema.parse({
      ...snapshot,
      addedAt: source.value.addedAt,
      associationId: source.value.associationId,
      rate,
      source: "frozen",
    });
  }

  const live = source.value;
  const producerPayout =
    ownerType === "producer" && currentRate !== null
      ? calculateProducerPayout(live, currentRate)
      : "0.00";
  const sophiaShare = centsToMoney(
    roundRatio(
      (moneyToCents(live.brokerFee) + moneyToCents(live.commissionAmount)) *
        (live.kayleeSplit === "none" ? 100n : 75n),
      100n,
    ),
  );
  const snapshot = buildPaySheetPolicySnapshot({
    ...live,
    producerPayout,
    sophiaShare,
  });
  return paySheetPolicyViewSchema.parse({
    ...snapshot,
    addedAt: live.addedAt,
    associationId: live.associationId,
    producerPayout:
      ownerType === "producer" && currentRate === null
        ? null
        : snapshot.producerPayout,
    rate: ownerType === "producer" ? currentRate : null,
    source: "live",
  });
}

function projectAdjustment(source: AdjustmentSource): PaySheetAdjustmentView {
  return paySheetAdjustmentViewSchema.parse({
    ...source.adjustment,
    policyTypeName: source.policyTypeName,
    producerDisplayName: source.producerDisplayName,
  });
}

function projectFrozenTotals(
  sheet: PaySheetRecord,
): PaySheetSophiaTotals | PaySheetProducerTotals {
  if (
    sheet.frozenTotals === null ||
    typeof sheet.frozenTotals !== "object" ||
    Array.isArray(sheet.frozenTotals)
  ) {
    throw new PaySheetReadConsistencyError();
  }
  const frozenTotals = sheet.frozenTotals as Readonly<Record<string, unknown>>;
  return sheet.ownerType === "sophia"
    ? paySheetSophiaTotalsSchema.parse(
        buildPaySheetFrozenTotals("sophia", frozenTotals),
      )
    : paySheetProducerTotalsSchema.parse(
        buildPaySheetFrozenTotals("producer", frozenTotals),
      );
}

function projectRate(rate: ProducerRateHistoryRecord | null): PaySheetRate | null {
  return rate === null ? null : buildPaySheetRateSnapshot(rate);
}

export function calculateProducerPayout(
  policy: Pick<
    LivePolicySource,
    "brokerFee" | "commissionAmount" | "transactionType"
  >,
  rate: PaySheetRate,
): string {
  const isNew = policy.transactionType === "New";
  const commissionRate = rateToHundredths(
    isNew ? rate.newCommissionRate : rate.renewalCommissionRate,
  );
  const brokerRate = rateToHundredths(
    isNew ? rate.newBrokerRate : rate.renewalBrokerRate,
  );
  return centsToMoney(
    roundRatio(
      moneyToCents(policy.commissionAmount) * commissionRate +
        moneyToCents(policy.brokerFee) * brokerRate,
      10_000n,
    ),
  );
}

async function loadHeaders(
  database: PaySheetReadDatabase,
  query: PaySheetListQuery,
): Promise<PaySheetHeaderSource[]> {
  const conditions: SQL[] = [];
  if (query.status !== "all") {
    conditions.push(eq(paySheets.status, query.status));
  }
  if (query.ownerType !== "all") {
    conditions.push(eq(paySheets.ownerType, query.ownerType));
  }
  if (query.ownerUserId !== null) {
    conditions.push(eq(paySheets.ownerUserId, query.ownerUserId));
  }
  if (query.periodMonth !== null) {
    conditions.push(eq(paySheets.periodMonth, query.periodMonth));
  }
  if (query.periodYear !== null) {
    conditions.push(eq(paySheets.periodYear, query.periodYear));
  }
  const rows = await baseHeaderQuery(database)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .limit(MAX_PAY_SHEET_ROWS + 1);
  if (rows.length > MAX_PAY_SHEET_ROWS) {
    throw new PaySheetBoundsError();
  }
  return rows.map(mapHeader);
}

function baseHeaderQuery(database: PaySheetReadDatabase) {
  return database
    .select({
      ...getTableColumns(paySheets),
      ownerDisplayName: staffProfiles.displayName,
      ownerEmail: users.email,
    })
    .from(paySheets)
    .innerJoin(users, eq(users.id, paySheets.ownerUserId))
    .leftJoin(staffProfiles, eq(staffProfiles.userId, paySheets.ownerUserId));
}

function mapHeader(
  row: Awaited<ReturnType<ReturnType<typeof baseHeaderQuery>["limit"]>>[number],
): PaySheetHeaderSource {
  const { ownerDisplayName, ownerEmail, ...sheet } = row;
  return {
    ownerDisplayName:
      sheet.ownerType === "sophia"
        ? "Sophia"
        : (ownerDisplayName ?? ownerEmail),
    ownerEmail,
    sheet,
  };
}

async function loadSource(
  database: PaySheetReadDatabase,
  header: PaySheetHeaderSource,
  asOf: Date,
): Promise<PaySheetSource> {
  const policiesForSheet =
    header.sheet.status === "closed"
      ? await loadFrozenPolicies(database, header.sheet.id)
      : await loadLivePolicies(database, header.sheet.id);
  const adjustments = await loadAdjustments(database, header.sheet.id);
  const rate =
    header.sheet.status === "open" &&
    header.sheet.ownerType === "producer" &&
    policiesForSheet.length > 0
      ? await loadEffectiveProducerRate(
          database,
          header.sheet.ownerUserId,
          asOf.toISOString().slice(0, 10),
        )
      : null;
  return { adjustments, header, policies: policiesForSheet, rate };
}

async function loadLivePolicies(
  database: PaySheetReadDatabase,
  paySheetId: string,
): Promise<PaySheetPolicySource[]> {
  const rows = await database
    .select({
      addedAt: paySheetPolicies.addedAt,
      associationId: paySheetPolicies.id,
      approvedAt: policies.approvedAt,
      brokerFee: policies.brokerFee,
      commissionAmount: policies.commissionAmount,
      effectiveDate: policies.effectiveDate,
      insuredName: policies.insuredName,
      kayleeSplit: policies.kayleeSplit,
      officeLocationId: policies.officeLocationId,
      policyId: policies.id,
      policyNumber: policies.policyNumber,
      policyTypeClass: policyTypes.classTag,
      policyTypeName: policyTypes.name,
      producerUserId: policies.producerUserId,
      transactionType: policies.transactionType,
    })
    .from(paySheetPolicies)
    .innerJoin(policies, eq(policies.id, paySheetPolicies.policyId))
    .innerJoin(policyTypes, eq(policyTypes.id, policies.policyTypeId))
    .where(eq(paySheetPolicies.paySheetId, paySheetId));
  return rows.map((value) => ({ kind: "live" as const, value }));
}

async function loadFrozenPolicies(
  database: PaySheetReadDatabase,
  paySheetId: string,
): Promise<PaySheetPolicySource[]> {
  const rows = await database
    .select({
      addedAt: paySheetPolicies.addedAt,
      associationId: paySheetPolicies.id,
      frozenPolicySnapshot: paySheetPolicies.frozenPolicySnapshot,
      frozenRateSnapshot: paySheetPolicies.frozenRateSnapshot,
    })
    .from(paySheetPolicies)
    .where(eq(paySheetPolicies.paySheetId, paySheetId));
  return rows.map((value) => ({ kind: "frozen" as const, value }));
}

async function loadAdjustments(
  database: PaySheetReadDatabase,
  paySheetId: string,
): Promise<AdjustmentSource[]> {
  const rows = await database
    .select({
      ...getTableColumns(paySheetAdjustments),
      policyTypeName: policyTypes.name,
      producerDisplayName: staffProfiles.displayName,
    })
    .from(paySheetAdjustments)
    .leftJoin(policyTypes, eq(policyTypes.id, paySheetAdjustments.policyTypeId))
    .leftJoin(
      staffProfiles,
      eq(staffProfiles.userId, paySheetAdjustments.producerUserId),
    )
    .where(eq(paySheetAdjustments.paySheetId, paySheetId));
  return rows.map(({ policyTypeName, producerDisplayName, ...adjustment }) => ({
    adjustment,
    policyTypeName,
    producerDisplayName,
  }));
}

export async function loadEffectiveProducerRate(
  database: PaySheetReadDatabase,
  producerUserId: string,
  asOfDate: string,
): Promise<ProducerRateHistoryRecord | null> {
  const [rate] = await database
    .select()
    .from(producerRateHistory)
    .where(
      and(
        eq(producerRateHistory.producerUserId, producerUserId),
        lte(producerRateHistory.effectiveDate, asOfDate),
      ),
    )
    .orderBy(desc(producerRateHistory.effectiveDate))
    .limit(1);
  return rate ?? null;
}

function compareSources(left: PaySheetSource, right: PaySheetSource): number {
  return (
    ownerOrder(left.header.sheet.ownerType) -
      ownerOrder(right.header.sheet.ownerType) ||
    compareText(left.header.ownerDisplayName, right.header.ownerDisplayName) ||
    right.header.sheet.periodYear - left.header.sheet.periodYear ||
    right.header.sheet.periodMonth - left.header.sheet.periodMonth ||
    left.header.sheet.id.localeCompare(right.header.sheet.id)
  );
}

function comparePolicies(left: PaySheetPolicyView, right: PaySheetPolicyView): number {
  return (
    compareText(left.insuredName, right.insuredName) ||
    left.policyId.localeCompare(right.policyId)
  );
}

function compareAdjustments(
  left: PaySheetAdjustmentView,
  right: PaySheetAdjustmentView,
): number {
  return (
    left.effectiveDate.localeCompare(right.effectiveDate) ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function ownerOrder(ownerType: "producer" | "sophia"): number {
  return ownerType === "sophia" ? 0 : 1;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en-US", { sensitivity: "base" });
}

function sumMoney(values: readonly string[]): bigint {
  return values.reduce((sum, value) => sum + moneyToCents(value), 0n);
}

function moneyToCents(value: string): bigint {
  const match = /^(-?)(0|[1-9][0-9]*)\.([0-9]{2})$/.exec(value);
  if (match === null || value === "-0.00") {
    throw new PaySheetReadConsistencyError();
  }
  const cents = BigInt(match[2]!) * 100n + BigInt(match[3]!);
  return match[1] === "-" ? -cents : cents;
}

function centsToMoney(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

function rateToHundredths(value: string): bigint {
  const match = /^(0|[1-9][0-9]{0,2})\.([0-9]{2})$/.exec(value);
  if (match === null) {
    throw new PaySheetReadConsistencyError();
  }
  return BigInt(match[1]!) * 100n + BigInt(match[2]!);
}

function roundRatio(numerator: bigint, denominator: bigint): bigint {
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  return sign * (quotient + (remainder * 2n >= denominator ? 1n : 0n));
}

function requireTimestamp(value: Date): void {
  if (Number.isNaN(value.getTime())) {
    throw new PaySheetReadConsistencyError();
  }
}
