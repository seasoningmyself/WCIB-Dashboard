import type { CurrentUser } from "../../../shared/current-user.js";
import type { KpiActualPeriod } from "../../../shared/kpi-actuals.js";
import {
  KPI_TARGET_MAX_COUNT,
  type KpiTarget,
  type KpiTargetListResponse,
  type KpiTargetMutationRequest,
} from "../../../shared/kpi-target-api.js";

export const KPI_PERIOD_OPTIONS: readonly {
  label: string;
  value: KpiActualPeriod;
}[] = Object.freeze([
  { label: "Full year", value: "full" },
  { label: "Q1", value: "Q1" },
  { label: "Q2", value: "Q2" },
  { label: "Q3", value: "Q3" },
  { label: "Q4", value: "Q4" },
]);

export interface KpiScopeSelection {
  producerUserId: string | null;
  scopeType: "company" | "producer";
}

export interface KpiTargetEditorValues {
  newPolicyCountTarget: string;
  newRevenueTarget: string;
  retentionRateTarget: string;
}

export type KpiTargetEditorResult =
  | { input: KpiTargetMutationRequest; success: true }
  | { message: string; success: false };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exactMoneyPattern = /^(0|[1-9][0-9]{0,14})\.([0-9]{2})$/;

export function isKpiAdmin(user: CurrentUser): boolean {
  return user.role === "admin" && user.capabilities.includes("admin");
}

export function encodeKpiScope(scope: KpiScopeSelection): string {
  return scope.scopeType === "company"
    ? "company"
    : `producer:${scope.producerUserId ?? ""}`;
}

export function decodeKpiScope(value: string): KpiScopeSelection | null {
  if (value === "company") return { producerUserId: null, scopeType: "company" };
  if (!value.startsWith("producer:")) return null;
  const producerUserId = value.slice("producer:".length);
  return uuidPattern.test(producerUserId)
    ? { producerUserId, scopeType: "producer" }
    : null;
}

export function findKpiTarget(
  response: KpiTargetListResponse,
  scope: KpiScopeSelection,
): KpiTarget | null {
  return response.items.find(
    (item) =>
      item.scopeType === scope.scopeType &&
      item.producerUserId === scope.producerUserId,
  ) ?? null;
}

export function kpiTargetEditorValues(
  target: KpiTarget | null,
): KpiTargetEditorValues {
  return {
    newPolicyCountTarget: target?.newPolicyCountTarget === null || target === null
      ? ""
      : String(target.newPolicyCountTarget),
    newRevenueTarget: target?.newRevenueTarget ?? "",
    retentionRateTarget: target?.retentionRateTarget ?? "",
  };
}

export function buildKpiTargetInput(
  values: KpiTargetEditorValues,
  scope: KpiScopeSelection,
): KpiTargetEditorResult {
  const count = normalizeCount(values.newPolicyCountTarget);
  if (count === undefined) {
    return { message: "New-policy goal must be a whole number at or above zero.", success: false };
  }
  const revenue = normalizeDecimal(values.newRevenueTarget, 12, null);
  if (revenue === undefined) {
    return { message: "Revenue goal must be a nonnegative amount with at most two decimals.", success: false };
  }
  const retention = normalizeDecimal(values.retentionRateTarget, 3, 10_000n);
  if (retention === undefined) {
    return { message: "Retention goal must be between 0 and 100 with at most two decimals.", success: false };
  }
  return {
    input: {
      newPolicyCountTarget: count,
      newRevenueTarget: revenue,
      producerUserId: scope.producerUserId,
      retentionRateTarget: retention,
    },
    success: true,
  };
}

export function emptyKpiTargetInput(
  scope: KpiScopeSelection,
): KpiTargetMutationRequest {
  return {
    newPolicyCountTarget: null,
    newRevenueTarget: null,
    producerUserId: scope.producerUserId,
    retentionRateTarget: null,
  };
}

export function formatKpiMoney(value: string): string {
  const match = exactMoneyPattern.exec(value);
  if (match === null) return value;
  const whole = (match[1] ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${whole}.${match[2] ?? "00"}`;
}

export function formatKpiRate(value: string | null): string {
  return value === null ? "Unavailable" : `${value}%`;
}

export function formatKpiCount(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

export function targetProgress(
  actual: bigint,
  target: bigint | null,
): { label: string; met: boolean; percent: number } | null {
  if (target === null || target <= 0n) return null;
  const tenths = actual >= target ? 1_000n : (actual * 1_000n) / target;
  const percent = Number(tenths) / 10;
  return {
    label: actual >= target ? "Goal met" : `${Math.round(percent)}% of goal`,
    met: actual >= target,
    percent,
  };
}

export function moneyToCents(value: string): bigint {
  const match = exactMoneyPattern.exec(value);
  if (match === null) return 0n;
  return BigInt(match[1] ?? "0") * 100n + BigInt(match[2] ?? "0");
}

export function rateToHundredths(value: string | null): bigint {
  if (value === null) return 0n;
  return moneyToCents(value);
}

export function countTargetUnits(value: string): bigint | null {
  return /^(0|[1-9][0-9]*)$/.test(value) ? BigInt(value) : null;
}

export function trendBarPercent(value: string, values: readonly string[]): number {
  const amounts = values.map(moneyToCents);
  const current = moneyToCents(value);
  const maximum = amounts.reduce((largest, amount) => amount > largest ? amount : largest, 0n);
  if (maximum === 0n || current === 0n) return 3;
  return Math.max(3, Number((current * 100n) / maximum));
}

function normalizeCount(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (!/^(0|[1-9][0-9]*)$/.test(trimmed)) return undefined;
  const count = Number(trimmed);
  return Number.isSafeInteger(count) && count <= KPI_TARGET_MAX_COUNT
    ? count
    : undefined;
}

function normalizeDecimal(
  value: string,
  maxWholeDigits: number,
  maximumHundredths: bigint | null,
): string | null | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(trimmed);
  if (match === null) return undefined;
  const whole = (match[1] ?? "0").replace(/^0+(?=\d)/, "");
  if (whole.length > maxWholeDigits) return undefined;
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const normalized = `${whole}.${fraction}`;
  if (
    maximumHundredths !== null &&
    BigInt(whole) * 100n + BigInt(fraction) > maximumHundredths
  ) {
    return undefined;
  }
  return normalized;
}
