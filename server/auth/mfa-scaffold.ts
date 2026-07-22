import type { MfaMethodSummary } from "../../shared/mfa-scaffold.js";
import { loadAccessPrincipal } from "./access-repository.js";
import { ensureMfaSettings, loadMfaState } from "./mfa-state.js";
import type { AuthDatabase } from "./users.js";

export interface AdminMfaScaffold {
  enforcementEnabled: boolean;
  methods: readonly MfaMethodSummary[];
  userId: string;
}

export class AdminMfaCapabilityRequiredError extends Error {
  constructor() {
    super("An active admin capability is required for MFA settings");
    this.name = "AdminMfaCapabilityRequiredError";
  }
}

export async function createAdminMfaScaffold(
  database: AuthDatabase,
  userId: string,
): Promise<AdminMfaScaffold> {
  const principal = await loadAccessPrincipal(database, userId);
  if (
    principal === null ||
    !principal.userActive ||
    !principal.capabilities.includes("admin")
  ) {
    throw new AdminMfaCapabilityRequiredError();
  }
  await ensureMfaSettings(database, userId);
  const settings = await getAdminMfaScaffold(database, userId);
  if (settings === null) throw new Error("MFA settings were not created");
  return settings;
}

export async function getAdminMfaScaffold(
  database: AuthDatabase,
  userId: string,
): Promise<AdminMfaScaffold | null> {
  const principal = await loadAccessPrincipal(database, userId);
  if (principal === null) return null;
  const state = await loadMfaState(database, userId, {
    adminEnforcementEnabled: false,
    allUsersEnforcementEnabled: false,
    isAdmin: principal.capabilities.includes("admin"),
  });
  return {
    enforcementEnabled: state.enrolled,
    methods: state.methods,
    userId,
  };
}
