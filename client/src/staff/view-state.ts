import type { CurrentUser } from "../../../shared/current-user.js";
import type {
  AdminStaffRate,
  AdminStaffRecord,
} from "../../../shared/admin-staff.js";

export function isManageStaffAdmin(user: CurrentUser): boolean {
  return user.role === "admin" && user.capabilities.includes("admin");
}

export function staffRoleLabel(role: AdminStaffRecord["role"]): string {
  return role === "producer" ? "Producer" : "Employee";
}

export function staffRateStateLabel(
  state: AdminStaffRecord["rateState"],
): string {
  switch (state) {
    case "configured":
      return "Rate configured";
    case "dormant":
      return "Rate history dormant";
    case "missing":
      return "Rate setup required";
    case "not_applicable":
      return "No producer rate";
  }
}

export function newestRatesFirst(
  rates: readonly AdminStaffRate[],
): readonly AdminStaffRate[] {
  return [...rates].sort(
    (left, right) =>
      right.effectiveDate.localeCompare(left.effectiveDate) ||
      right.id.localeCompare(left.id),
  );
}

export function formatStaffDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

export function formatStaffTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(date);
}

export function formatRate(value: string): string {
  return `${value}%`;
}
