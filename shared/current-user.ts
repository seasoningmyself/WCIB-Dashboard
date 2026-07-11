import type { AccessCapability } from "./access.js";

export const APP_NAVIGATION_IDS = [
  "approvals",
  "help_requests",
  "policy_ledger",
  "mga_payables",
  "pay_sheets",
  "kpis",
  "manage_staff",
  "settings",
  "turn_in",
  "my_items",
  "my_commissions",
] as const;

export type AppNavigationId = (typeof APP_NAVIGATION_IDS)[number];

export const CURRENT_USER_ROLES = [
  "admin",
  "employee",
  "producer",
] as const;

export type CurrentUserRole = (typeof CURRENT_USER_ROLES)[number];

export interface CurrentUserResponse {
  user: {
    allowedNavigation: readonly AppNavigationId[];
    capabilities: readonly AccessCapability[];
    displayName: string | null;
    email: string;
    id: string;
    role: CurrentUserRole | null;
  };
}
