import { eq, inArray } from "drizzle-orm";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import {
  KPI_PERIOD_MONTHS,
  kpiActualQuerySchema,
  kpiActualResponseSchema,
  type KpiActualQuery,
  type KpiActualResponse,
} from "../../shared/kpi-actuals.js";
import { officeLocations, staffProfiles, users } from "../db/schema.js";
import {
  listAllClosedProducerKpiFacts,
  listClosedKpiFacts,
  type ClosedKpiFact,
  type KpiFactDatabase,
} from "./closed-facts.js";
import {
  KPI_ADMIN_ACCESS,
  KpiTargetAccessDeniedError,
  listKpiProducerSources,
} from "./targets.js";
import { evaluateAccess } from "../auth/access.js";

const KPI_ACTUAL_MAX_FACTS = 100_000;
const moneyPattern = /^(0|[1-9][0-9]{0,11})\.([0-9]{2})$/;

export interface KpiActualSource {
  actuals: KpiActualResponse;
  agencyFactCount: number;
  payoutFactCount: number;
}

export interface KpiActualLabels {
  offices: ReadonlyMap<string, string>;
  producers: ReadonlyMap<string, string>;
  scopeDisplayName: string | null;
}

interface MoneyCountGroup {
  agencyRevenueCents: bigint;
  newPolicyCount: number;
  policyCount: number;
}

interface PayoutGroup {
  bookPayoutCents: bigint;
  firstYearHousePayoutCents: bigint;
  policyCount: number;
}

export class KpiActualProducerNotFoundError extends Error {
  constructor() {
    super("KPI actual producer was not found");
    this.name = "KpiActualProducerNotFoundError";
  }
}

export class KpiActualBoundsError extends Error {
  constructor() {
    super("KPI actual fact set exceeds the supported bound");
    this.name = "KpiActualBoundsError";
  }
}

export class KpiActualConsistencyError extends Error {
  constructor() {
    super("KPI actual frozen facts are inconsistent");
    this.name = "KpiActualConsistencyError";
  }
}

export async function loadKpiActualSource(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  rawQuery: unknown,
): Promise<KpiActualSource> {
  requireKpiAdmin(context);
  const query = kpiActualQuerySchema.parse(rawQuery);
  const periodMonths = KPI_PERIOD_MONTHS[query.period];
  const factDatabase = database as KpiFactDatabase;

  let agencyFacts: ClosedKpiFact[];
  let payoutFacts: ClosedKpiFact[];
  let scopeDisplayName: string | null = null;
  if (query.scopeType === "company") {
    [agencyFacts, payoutFacts] = await Promise.all([
      listClosedKpiFacts(factDatabase, {
        periodMonths,
        scopeType: "company",
        year: query.year,
      }),
      listAllClosedProducerKpiFacts(factDatabase, {
        periodMonths,
        year: query.year,
      }),
    ]);
  } else {
    const producers = await listKpiProducerSources(database);
    const producer = producers.find(
      ({ producerUserId }) => producerUserId === query.producerUserId,
    );
    if (producer === undefined) throw new KpiActualProducerNotFoundError();
    scopeDisplayName = producer.displayName;
    agencyFacts = await listClosedKpiFacts(factDatabase, {
      periodMonths,
      producerUserId: producer.producerUserId,
      scopeType: "producer",
      year: query.year,
    });
    payoutFacts = agencyFacts;
  }
  if (
    agencyFacts.length > KPI_ACTUAL_MAX_FACTS ||
    payoutFacts.length > KPI_ACTUAL_MAX_FACTS
  ) {
    throw new KpiActualBoundsError();
  }

  const labels = await loadLabels(
    database,
    agencyFacts,
    payoutFacts,
    scopeDisplayName,
  );
  return Object.freeze({
    actuals: buildKpiActualResponse(query, agencyFacts, payoutFacts, labels),
    agencyFactCount: agencyFacts.length,
    payoutFactCount: payoutFacts.length,
  });
}

export function buildKpiActualResponse(
  query: KpiActualQuery,
  agencyFacts: readonly ClosedKpiFact[],
  payoutFacts: readonly ClosedKpiFact[],
  labels: KpiActualLabels,
): KpiActualResponse {
  const months = KPI_PERIOD_MONTHS[query.period];
  const scopedProducerUserId = query.scopeType === "producer"
    ? requireProducerUserId(query.producerUserId)
    : null;
  const monthly = new Map<number, MoneyCountGroup & { producerPayoutCents: bigint }>(
    months.map((month) => [
      month,
      {
        agencyRevenueCents: 0n,
        newPolicyCount: 0,
        policyCount: 0,
        producerPayoutCents: 0n,
      },
    ]),
  );
  const transactionTypes = new Map<string, MoneyCountGroup>();
  const offices = new Map<string, MoneyCountGroup>();
  const producerPayouts = new Map<string, PayoutGroup>();
  let agencyRevenueCents = 0n;
  let newPolicyCount = 0;
  let newRevenueCents = 0n;
  let wonBackCount = 0;
  let wonBackRevenueCents = 0n;

  for (const fact of agencyFacts) {
    const revenueCents = parseMoney(fact.snapshot.agencyRevenue);
    const isNew = fact.snapshot.transactionType === "New";
    agencyRevenueCents += revenueCents;
    if (isNew) {
      newPolicyCount += 1;
      newRevenueCents += revenueCents;
    }
    if (fact.snapshot.transactionType === "Won Back") {
      wonBackCount += 1;
      wonBackRevenueCents += revenueCents;
    }
    addMoneyCount(
      requireGroup(monthly, fact.periodMonth),
      revenueCents,
      isNew,
    );
    addMoneyCount(
      getMoneyCount(transactionTypes, fact.snapshot.transactionType),
      revenueCents,
      isNew,
    );
    addMoneyCount(
      getMoneyCount(offices, fact.snapshot.officeLocationId),
      revenueCents,
      isNew,
    );
  }

  let producerBookPayoutCents = 0n;
  let producerFirstYearHousePayoutCents = 0n;
  for (const fact of payoutFacts) {
    if (
      fact.ownerType !== "producer" ||
      fact.snapshot.producerUserId === null ||
      fact.snapshot.producerUserId !== fact.ownerUserId
    ) {
      throw new KpiActualConsistencyError();
    }
    const payoutCents = parseMoney(fact.snapshot.producerPayout);
    const group = getPayoutGroup(producerPayouts, fact.ownerUserId);
    group.policyCount += 1;
    if (fact.snapshot.kayleeSplit === "house") {
      group.firstYearHousePayoutCents += payoutCents;
      producerFirstYearHousePayoutCents += payoutCents;
    } else {
      group.bookPayoutCents += payoutCents;
      producerBookPayoutCents += payoutCents;
    }
    requireGroup(monthly, fact.periodMonth).producerPayoutCents += payoutCents;
  }

  const policyCount = agencyFacts.length;
  const existingPolicyCount = policyCount - newPolicyCount;
  const response = {
    empty: agencyFacts.length === 0 && payoutFacts.length === 0,
    monthly: months.map((month) => {
      const group = requireGroup(monthly, month);
      return {
        agencyRevenue: formatMoney(group.agencyRevenueCents),
        month,
        newPolicyCount: group.newPolicyCount,
        policyCount: group.policyCount,
        producerPayout: formatMoney(group.producerPayoutCents),
      };
    }),
    offices: [...offices.entries()]
      .map(([officeLocationId, group]) => ({
        agencyRevenue: formatMoney(group.agencyRevenueCents),
        displayName: labels.offices.get(officeLocationId) ?? "Historical office",
        newPolicyCount: group.newPolicyCount,
        officeLocationId,
        policyCount: group.policyCount,
      }))
      .sort(compareNamedIds("officeLocationId")),
    period: query.period,
    producerPayouts: [...producerPayouts.entries()]
      .map(([producerUserId, group]) => ({
        bookPayout: formatMoney(group.bookPayoutCents),
        displayName: labels.producers.get(producerUserId) ?? "Historical producer",
        firstYearHousePayout: formatMoney(group.firstYearHousePayoutCents),
        policyCount: group.policyCount,
        producerUserId,
        totalPayout: formatMoney(
          group.bookPayoutCents + group.firstYearHousePayoutCents,
        ),
      }))
      .sort(compareNamedIds("producerUserId")),
    scope: {
      displayName: query.scopeType === "producer" ? labels.scopeDisplayName : null,
      producerUserId: scopedProducerUserId,
      scopeType: query.scopeType,
    },
    totals: {
      agencyRevenue: formatMoney(agencyRevenueCents),
      existingPolicyCount,
      newPolicyCount,
      newRevenue: formatMoney(newRevenueCents),
      policyCount,
      producerBookPayout: formatMoney(producerBookPayoutCents),
      producerFirstYearHousePayout: formatMoney(
        producerFirstYearHousePayoutCents,
      ),
      producerPayout: formatMoney(
        producerBookPayoutCents + producerFirstYearHousePayoutCents,
      ),
      retentionRate: policyCount === 0
        ? null
        : formatRate(existingPolicyCount, policyCount),
      wonBackCount,
      wonBackRevenue: formatMoney(wonBackRevenueCents),
    },
    transactionTypes: [...transactionTypes.entries()]
      .map(([transactionType, group]) => ({
        agencyRevenue: formatMoney(group.agencyRevenueCents),
        policyCount: group.policyCount,
        transactionType,
      }))
      .sort((left, right) => left.transactionType.localeCompare(
        right.transactionType,
        "en-US",
        { sensitivity: "base" },
      )),
    year: query.year,
  };
  return kpiActualResponseSchema.parse(response);
}

export function projectAdminKpiActualSource(
  source: Readonly<KpiActualSource>,
  context: AuthorizedRequestContext,
): KpiActualResponse | null {
  if (!evaluateAccess(context.principal, KPI_ADMIN_ACCESS).allowed) return null;
  return kpiActualResponseSchema.parse(source.actuals);
}

async function loadLabels(
  database: AuthDatabase,
  agencyFacts: readonly ClosedKpiFact[],
  payoutFacts: readonly ClosedKpiFact[],
  scopeDisplayName: string | null,
): Promise<KpiActualLabels> {
  const officeIds = [...new Set(
    agencyFacts.map(({ snapshot }) => snapshot.officeLocationId),
  )];
  const producerIds = [...new Set(
    payoutFacts.map(({ ownerUserId }) => ownerUserId),
  )];
  const [officeRows, producerRows] = await Promise.all([
    officeIds.length === 0
      ? []
      : database
          .select({ id: officeLocations.id, name: officeLocations.name })
          .from(officeLocations)
          .where(inArray(officeLocations.id, officeIds)),
    producerIds.length === 0
      ? []
      : database
          .select({
            displayName: users.displayName,
            userId: staffProfiles.userId,
          })
          .from(staffProfiles)
          .innerJoin(users, eq(users.id, staffProfiles.userId))
          .where(inArray(staffProfiles.userId, producerIds)),
  ]);
  return Object.freeze({
    offices: new Map(officeRows.map(({ id, name }) => [id, name])),
    producers: new Map(
      producerRows.map(({ displayName, userId }) => [userId, displayName]),
    ),
    scopeDisplayName,
  });
}

function getMoneyCount(
  groups: Map<string, MoneyCountGroup>,
  key: string,
): MoneyCountGroup {
  const existing = groups.get(key);
  if (existing !== undefined) return existing;
  const created = {
    agencyRevenueCents: 0n,
    newPolicyCount: 0,
    policyCount: 0,
  };
  groups.set(key, created);
  return created;
}

function getPayoutGroup(
  groups: Map<string, PayoutGroup>,
  key: string,
): PayoutGroup {
  const existing = groups.get(key);
  if (existing !== undefined) return existing;
  const created = {
    bookPayoutCents: 0n,
    firstYearHousePayoutCents: 0n,
    policyCount: 0,
  };
  groups.set(key, created);
  return created;
}

function requireGroup<T>(groups: Map<number, T>, month: number): T {
  const group = groups.get(month);
  if (group === undefined) throw new KpiActualConsistencyError();
  return group;
}

function addMoneyCount(
  group: MoneyCountGroup,
  revenueCents: bigint,
  isNew: boolean,
): void {
  group.agencyRevenueCents += revenueCents;
  group.policyCount += 1;
  if (isNew) group.newPolicyCount += 1;
}

function parseMoney(value: string): bigint {
  const match = moneyPattern.exec(value);
  if (match === null) throw new KpiActualConsistencyError();
  return BigInt(match[1] ?? "0") * 100n + BigInt(match[2] ?? "0");
}

function formatMoney(cents: bigint): string {
  if (cents < 0n) throw new KpiActualConsistencyError();
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

function formatRate(numerator: number, denominator: number): string {
  const hundredths =
    (BigInt(numerator) * 10_000n + BigInt(Math.floor(denominator / 2))) /
    BigInt(denominator);
  return `${hundredths / 100n}.${(hundredths % 100n)
    .toString()
    .padStart(2, "0")}`;
}

function compareNamedIds<Key extends "officeLocationId" | "producerUserId">(
  idKey: Key,
) {
  return (
    left: { displayName: string } & Record<Key, string>,
    right: { displayName: string } & Record<Key, string>,
  ): number => {
    const byName = left.displayName.localeCompare(right.displayName, "en-US", {
      sensitivity: "base",
    });
    return byName || left[idKey].localeCompare(right[idKey]);
  };
}

function requireKpiAdmin(context: AuthorizedRequestContext): void {
  if (!evaluateAccess(context.principal, KPI_ADMIN_ACCESS).allowed) {
    throw new KpiTargetAccessDeniedError();
  }
}

function requireProducerUserId(value: string | undefined): string {
  if (value === undefined) throw new KpiActualConsistencyError();
  return value;
}
