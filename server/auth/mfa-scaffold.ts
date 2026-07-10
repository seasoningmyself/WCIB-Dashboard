import { eq } from "drizzle-orm";
import {
  FOUNDATION_MFA_ENFORCEMENT_ENABLED,
  type MfaMethodType,
} from "../../shared/mfa-scaffold.js";
import {
  userMfaMethodPlaceholders,
  userMfaSettings,
} from "../db/schema.js";
import { loadAccessPrincipal } from "./access-repository.js";
import type { AuthDatabase } from "./users.js";

export interface MfaMethodPlaceholder {
  enabled: false;
  methodType: MfaMethodType;
}

export interface AdminMfaScaffold {
  enforcementEnabled: false;
  methods: readonly MfaMethodPlaceholder[];
  userId: string;
}

export class AdminMfaCapabilityRequiredError extends Error {
  constructor() {
    super("An active admin capability is required for the MFA scaffold");
    this.name = "AdminMfaCapabilityRequiredError";
  }
}

export class ActiveMfaStateInFoundationError extends Error {
  constructor() {
    super("Active MFA state is not permitted during Foundation");
    this.name = "ActiveMfaStateInFoundationError";
  }
}

export async function createAdminMfaScaffold(
  database: AuthDatabase,
  userId: string,
  methodTypes: readonly MfaMethodType[] = [],
): Promise<AdminMfaScaffold> {
  const principal = await loadAccessPrincipal(database, userId);
  if (
    principal === null ||
    !principal.userActive ||
    !principal.capabilities.includes("admin")
  ) {
    throw new AdminMfaCapabilityRequiredError();
  }

  const uniqueMethodTypes = [...new Set(methodTypes)];
  await database.transaction(async (transaction) => {
    await transaction
      .insert(userMfaSettings)
      .values({ userId })
      .onConflictDoNothing();
    if (uniqueMethodTypes.length > 0) {
      await transaction
        .insert(userMfaMethodPlaceholders)
        .values(
          uniqueMethodTypes.map((methodType) => ({ methodType, userId })),
        )
        .onConflictDoNothing();
    }
  });

  const scaffold = await getAdminMfaScaffold(database, userId);
  if (scaffold === null) {
    throw new Error("MFA scaffold creation returned no record");
  }
  return scaffold;
}

export async function getAdminMfaScaffold(
  database: AuthDatabase,
  userId: string,
): Promise<AdminMfaScaffold | null> {
  const [settings] = await database
    .select({ enforcementEnabled: userMfaSettings.enforcementEnabled })
    .from(userMfaSettings)
    .where(eq(userMfaSettings.userId, userId))
    .limit(1);
  if (settings === undefined) {
    return null;
  }

  const methods = await database
    .select({
      enabled: userMfaMethodPlaceholders.isEnabled,
      methodType: userMfaMethodPlaceholders.methodType,
    })
    .from(userMfaMethodPlaceholders)
    .where(eq(userMfaMethodPlaceholders.userId, userId))
    .orderBy(userMfaMethodPlaceholders.methodType);

  if (
    settings.enforcementEnabled ||
    methods.some((method) => method.enabled) ||
    FOUNDATION_MFA_ENFORCEMENT_ENABLED
  ) {
    throw new ActiveMfaStateInFoundationError();
  }

  return {
    enforcementEnabled: false,
    methods: methods.map((method) => ({
      enabled: false,
      methodType: method.methodType,
    })),
    userId,
  };
}
