import { eq } from "drizzle-orm";
import type {
  AppNavigationId,
  CurrentUserResponse,
  CurrentUserRole,
} from "../../shared/current-user.js";
import { staffProfiles, users } from "../db/schema.js";
import type { AuthorizedRequestContext } from "./authorization.js";
import type { AccessPrincipal } from "./access.js";
import type { AuthDatabase } from "./users.js";

const NAVIGATION_BY_ROLE = {
  admin: [
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
  ],
  employee: ["turn_in", "my_items"],
  producer: ["turn_in", "my_items", "my_commissions"],
} as const satisfies Readonly<
  Record<CurrentUserRole, readonly AppNavigationId[]>
>;

export interface CurrentUserIdentity {
  displayName: string | null;
  email: string;
  id: string;
}

export class CurrentUserProjectionError extends Error {
  constructor() {
    super("Current-user identity does not match the authorized principal");
    this.name = "CurrentUserProjectionError";
  }
}

export async function loadCurrentUserIdentity(
  database: AuthDatabase,
  userId: string,
): Promise<CurrentUserIdentity | null> {
  const [identity] = await database
    .select({
      displayName: staffProfiles.displayName,
      email: users.email,
      id: users.id,
    })
    .from(users)
    .leftJoin(staffProfiles, eq(users.id, staffProfiles.userId))
    .where(eq(users.id, userId))
    .limit(1);

  return identity ?? null;
}

export function projectCurrentUser(
  identity: Readonly<CurrentUserIdentity>,
  context: AuthorizedRequestContext,
): CurrentUserResponse {
  const { principal } = context;
  if (!principal.userActive || identity.id !== principal.userId) {
    throw new CurrentUserProjectionError();
  }

  const role = currentUserRole(principal);
  return {
    user: {
      allowedNavigation:
        role === null ? [] : [...NAVIGATION_BY_ROLE[role]],
      capabilities: [...principal.capabilities].sort(),
      displayName: identity.displayName,
      email: identity.email,
      id: principal.userId,
      role,
    },
  };
}

export function allowedNavigationForPrincipal(
  principal: Readonly<AccessPrincipal>,
): readonly AppNavigationId[] {
  if (!principal.userActive) {
    return [];
  }
  const role = currentUserRole(principal);
  return role === null ? [] : [...NAVIGATION_BY_ROLE[role]];
}

function currentUserRole(
  principal: Readonly<AccessPrincipal>,
): CurrentUserRole | null {
  if (principal.capabilities.includes("admin")) {
    return "admin";
  }
  return principal.staffRole;
}
