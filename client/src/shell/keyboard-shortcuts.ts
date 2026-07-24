import type { AppNavigationId } from "../../../shared/current-user.js";
import type { ShellNavigationItem } from "./navigation.js";

export const GO_TO_SHORTCUTS = [
  { id: "approvals", key: "r", label: "Review Queue" },
  { id: "turn_in", key: "t", label: "Check Turn-In" },
  { id: "my_items", key: "d", label: "My Drafts" },
  { id: "policy_ledger", key: "l", label: "Policy Ledger" },
  { id: "mga_payables", key: "m", label: "MGA Payables" },
  { id: "pay_sheets", key: "p", label: "Pay Sheets" },
  { id: "kpis", key: "a", label: "Agency Overview" },
  { id: "manage_staff", key: "s", label: "Manage Staff" },
] as const satisfies readonly {
  id: AppNavigationId;
  key: string;
  label: string;
}[];

export function goToDestination(
  key: string,
  navigation: readonly ShellNavigationItem[],
): ShellNavigationItem | null {
  const shortcut = GO_TO_SHORTCUTS.find((item) => item.key === key.toLowerCase());
  if (shortcut === undefined) return null;
  return navigation.find(({ id }) => id === shortcut.id) ?? null;
}

export function availableGoToShortcuts(
  navigation: readonly ShellNavigationItem[],
): readonly (typeof GO_TO_SHORTCUTS)[number][] {
  const allowed = new Set(navigation.map(({ id }) => id));
  return GO_TO_SHORTCUTS.filter(({ id }) => allowed.has(id));
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.matches("input, textarea, select") ||
    target.closest('[role="textbox"]') !== null
  );
}
