import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PaySheetPolicySnapshot } from "../../shared/pay-sheet-snapshots.js";
import * as databaseSchema from "../db/schema.js";
import { inActiveBusinessGeneration } from "../db/business-state.js";
import { paySheetPolicies, paySheets } from "../db/schema.js";
import { parsePaySheetPolicySnapshot } from "../pay-sheets/snapshots.js";

export type KpiFactDatabase = NodePgDatabase<typeof databaseSchema>;

export type ClosedKpiFactScope =
  | {
      periodMonths?: readonly number[];
      scopeType: "company";
      year: number;
    }
  | {
      periodMonths?: readonly number[];
      producerUserId: string;
      scopeType: "producer";
      year: number;
    };

export interface ClosedKpiFact {
  addedAt: Date;
  ownerType: "sophia" | "producer";
  ownerUserId: string;
  paySheetId: string;
  paySheetPolicyId: string;
  periodMonth: number;
  periodYear: number;
  snapshot: PaySheetPolicySnapshot;
}

export interface ClosedKpiPeriodScope {
  periodMonths?: readonly number[];
  year: number;
}

export interface ClosedKpiActualInputs {
  newPolicyCount: number;
  newRevenueCents: bigint;
  retentionDenominator: number;
  retentionNumerator: number;
  transactionTypeCounts: Readonly<Record<string, number>>;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const moneyPattern = /^(0|[1-9][0-9]{0,11})\.([0-9]{2})$/;

export async function listClosedKpiFacts(
  database: KpiFactDatabase,
  scope: ClosedKpiFactScope,
): Promise<ClosedKpiFact[]> {
  const conditions: SQL[] = [
    eq(paySheets.status, "closed"),
    eq(paySheets.periodYear, requireYear(scope.year)),
    inActiveBusinessGeneration(paySheets.businessGenerationId),
    inActiveBusinessGeneration(paySheetPolicies.businessGenerationId),
  ];
  if (scope.scopeType === "company") {
    conditions.push(eq(paySheets.ownerType, "sophia"));
  } else {
    conditions.push(eq(paySheets.ownerType, "producer"));
    conditions.push(
      eq(paySheets.ownerUserId, requireUuid(scope.producerUserId)),
    );
  }

  const periodMonths = normalizePeriodMonths(scope.periodMonths);
  if (periodMonths !== undefined) {
    conditions.push(inArray(paySheets.periodMonth, periodMonths));
  }

  return loadClosedKpiFacts(database, conditions);
}

export async function listAllClosedProducerKpiFacts(
  database: KpiFactDatabase,
  scope: ClosedKpiPeriodScope,
): Promise<ClosedKpiFact[]> {
  const conditions: SQL[] = [
    eq(paySheets.status, "closed"),
    eq(paySheets.ownerType, "producer"),
    eq(paySheets.periodYear, requireYear(scope.year)),
    inActiveBusinessGeneration(paySheets.businessGenerationId),
    inActiveBusinessGeneration(paySheetPolicies.businessGenerationId),
  ];
  const periodMonths = normalizePeriodMonths(scope.periodMonths);
  if (periodMonths !== undefined) {
    conditions.push(inArray(paySheets.periodMonth, periodMonths));
  }
  return loadClosedKpiFacts(database, conditions);
}

async function loadClosedKpiFacts(
  database: KpiFactDatabase,
  conditions: readonly SQL[],
): Promise<ClosedKpiFact[]> {
  const records = await database
    .select({
      addedAt: paySheetPolicies.addedAt,
      frozenPolicySnapshot: paySheetPolicies.frozenPolicySnapshot,
      ownerType: paySheets.ownerType,
      ownerUserId: paySheets.ownerUserId,
      paySheetId: paySheets.id,
      paySheetPolicyId: paySheetPolicies.id,
      periodMonth: paySheets.periodMonth,
      periodYear: paySheets.periodYear,
    })
    .from(paySheetPolicies)
    .innerJoin(paySheets, eq(paySheets.id, paySheetPolicies.paySheetId))
    .where(and(...conditions))
    .orderBy(
      asc(paySheets.periodYear),
      asc(paySheets.periodMonth),
      asc(paySheetPolicies.id),
    );

  return records.map(({ frozenPolicySnapshot, ...record }) => ({
    ...record,
    snapshot: parsePaySheetPolicySnapshot(frozenPolicySnapshot),
  }));
}

export function deriveClosedKpiActualInputs(
  facts: readonly ClosedKpiFact[],
): ClosedKpiActualInputs {
  let newPolicyCount = 0;
  let newRevenueCents = 0n;
  let retentionNumerator = 0;
  const transactionTypeCounts: Record<string, number> = {};

  for (const fact of facts) {
    const transactionType = fact.snapshot.transactionType;
    transactionTypeCounts[transactionType] =
      (transactionTypeCounts[transactionType] ?? 0) + 1;
    if (transactionType === "New") {
      newPolicyCount += 1;
      newRevenueCents += parseMoneyToCents(fact.snapshot.agencyRevenue);
    } else {
      retentionNumerator += 1;
    }
  }

  return Object.freeze({
    newPolicyCount,
    newRevenueCents,
    retentionDenominator: facts.length,
    retentionNumerator,
    transactionTypeCounts: Object.freeze(
      Object.fromEntries(Object.entries(transactionTypeCounts).sort()),
    ),
  });
}

function requireYear(year: number): number {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new Error("KPI fact year is invalid");
  }
  return year;
}

function requireUuid(value: string): string {
  if (!uuidPattern.test(value)) {
    throw new Error("KPI producer scope UUID is invalid");
  }
  return value;
}

function normalizePeriodMonths(
  months: readonly number[] | undefined,
): number[] | undefined {
  if (months === undefined) {
    return undefined;
  }
  if (
    months.length === 0 ||
    months.some((month) => !Number.isInteger(month) || month < 1 || month > 12)
  ) {
    throw new Error("KPI fact period months are invalid");
  }
  return [...new Set(months)].sort((left, right) => left - right);
}

function parseMoneyToCents(value: string): bigint {
  const match = moneyPattern.exec(value);
  if (match === null) {
    throw new Error("KPI snapshot money is invalid");
  }
  return BigInt(match[1] ?? "0") * 100n + BigInt(match[2] ?? "0");
}
