import {
  APP_NAVIGATION_IDS,
  type AppNavigationId,
} from "../../../shared/current-user.js";

export interface ShellNavigationItem {
  id: AppNavigationId;
  label: string;
  path: string;
}

export type ShellNavigationGroupId = "daily" | "money" | "setup";

export interface ShellNavigationGroup {
  id: ShellNavigationGroupId;
  items: readonly ShellNavigationItem[];
  label: string;
}

const NAVIGATION_ITEMS: Readonly<
  Record<AppNavigationId, ShellNavigationItem>
> = {
  approvals: { id: "approvals", label: "Approvals", path: "/approvals" },
  help_requests: {
    id: "help_requests",
    label: "Help Requests",
    path: "/help-requests",
  },
  policy_ledger: {
    id: "policy_ledger",
    label: "Policy Ledger",
    path: "/policy-ledger",
  },
  mga_payables: {
    id: "mga_payables",
    label: "MGA Payables",
    path: "/mga-payables",
  },
  pay_sheets: {
    id: "pay_sheets",
    label: "Pay Sheets",
    path: "/pay-sheets",
  },
  kpis: { id: "kpis", label: "KPIs & Goals", path: "/kpis" },
  manage_staff: {
    id: "manage_staff",
    label: "Manage Staff",
    path: "/staff",
  },
  settings: { id: "settings", label: "Settings", path: "/settings" },
  turn_in: { id: "turn_in", label: "Check Turn-In", path: "/turn-in" },
  my_items: { id: "my_items", label: "My Drafts", path: "/my-drafts" },
  my_commissions: {
    id: "my_commissions",
    label: "My Commissions",
    path: "/my-commissions",
  },
};

const navigationIdSet = new Set<string>(APP_NAVIGATION_IDS);

const NAVIGATION_GROUPS: readonly {
  id: ShellNavigationGroupId;
  identifiers: readonly AppNavigationId[];
  label: string;
}[] = [
  {
    id: "daily",
    identifiers: ["approvals", "help_requests", "turn_in", "my_items"],
    label: "Daily",
  },
  {
    id: "money",
    identifiers: [
      "policy_ledger",
      "mga_payables",
      "pay_sheets",
      "kpis",
      "my_commissions",
    ],
    label: "Money",
  },
  {
    id: "setup",
    identifiers: ["manage_staff", "settings"],
    label: "Setup",
  },
];

export type ShellRoute =
  | { item: ShellNavigationItem; status: "ready" }
  | { status: "empty" }
  | { status: "not_found" };

export function resolveAuthorizedNavigation(
  identifiers: readonly string[],
): readonly ShellNavigationItem[] {
  const seen = new Set<AppNavigationId>();
  const navigation: ShellNavigationItem[] = [];
  for (const identifier of identifiers) {
    if (!navigationIdSet.has(identifier)) {
      continue;
    }
    const id = identifier as AppNavigationId;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    navigation.push(NAVIGATION_ITEMS[id]);
  }
  return navigation;
}

export function groupAuthorizedNavigation(
  navigation: readonly ShellNavigationItem[],
): readonly ShellNavigationGroup[] {
  const byId = new Map(navigation.map((item) => [item.id, item]));
  return NAVIGATION_GROUPS.flatMap((group) => {
    const items = group.identifiers.flatMap((identifier) => {
      const item = byId.get(identifier);
      return item === undefined ? [] : [item];
    });
    return items.length === 0 ? [] : [{ ...group, items }];
  });
}

export function resolveShellRoute(
  rawPath: string,
  navigation: readonly ShellNavigationItem[],
): ShellRoute {
  if (navigation.length === 0) {
    return { status: "empty" };
  }
  const path = normalizeShellPath(rawPath);
  if (path === "/") {
    const first = navigation[0];
    return first === undefined
      ? { status: "empty" }
      : { item: first, status: "ready" };
  }
  const item = navigation.find((candidate) => candidate.path === path);
  return item === undefined
    ? { status: "not_found" }
    : { item, status: "ready" };
}

export function normalizeShellPath(value: string): string {
  const path = value.trim().split(/[?#]/, 1)[0] ?? "";
  if (!path.startsWith("/") || path.startsWith("//")) {
    return "/";
  }
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path;
}
