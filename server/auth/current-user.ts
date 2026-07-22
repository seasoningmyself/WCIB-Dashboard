import { eq } from "drizzle-orm";
import type {
  AppNavigationId,
  CurrentUserResponse,
  CurrentUserRole,
} from "../../shared/current-user.js";
import { users } from "../db/schema.js";
import type { MfaState } from "../../shared/mfa-scaffold.js";
import { loadMfaState } from "./mfa-state.js";
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
  ],
  employee: ["turn_in", "my_items", "settings"],
  producer: ["turn_in", "my_items", "my_commissions", "settings"],
} as const satisfies Readonly<
  Record<CurrentUserRole, readonly AppNavigationId[]>
>;

export interface CurrentUserIdentity {
  displayName: string;
  email: string;
  id: string;
  mfa?: MfaState;
  passwordChangeRequiredAt: Date | null;
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
  mfaOptions?: {
    adminEnforcementEnabled: boolean;
    allUsersEnforcementEnabled?: boolean;
    isAdmin: boolean;
    isSupportEngineer?: boolean;
  },
): Promise<CurrentUserIdentity | null> {
  const [identity] = await database
    .select({
      displayName: users.displayName,
      email: users.email,
      id: users.id,
      passwordChangeRequiredAt: users.passwordChangeRequiredAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (identity === undefined) return null;
  return {
    ...identity,
    ...(mfaOptions === undefined
      ? {}
      : { mfa: await loadMfaState(database, userId, mfaOptions) }),
  };
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
  const authenticationState =
    context.authentication?.state ?? "authenticated";
  const workspaceAvailable =
    authenticationState === "authenticated" &&
    identity.mfa?.enrollmentRequired !== true;
  return {
    user: {
      authenticationState,
      allowedNavigation:
        !workspaceAvailable
          ? []
          : [...allowedNavigationForPrincipal(principal)],
      capabilities: [...principal.capabilities].sort(),
      displayName: identity.displayName,
      email: identity.email,
      id: principal.userId,
      ...(identity.mfa === undefined ? {} : { mfa: identity.mfa }),
      passwordChangeRequired: identity.passwordChangeRequiredAt !== null,
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
  const roleNavigation = role === null ? [] : [...NAVIGATION_BY_ROLE[role]];
  if (!principal.capabilities.includes("support_engineer")) {
    return roleNavigation;
  }
  return [
    "support",
    ...roleNavigation.filter((identifier) => identifier !== "settings"),
    "settings",
  ];
}

function currentUserRole(
  principal: Readonly<AccessPrincipal>,
): CurrentUserRole | null {
  if (principal.capabilities.includes("admin")) {
    return "admin";
  }
  return principal.staffRole;
}
