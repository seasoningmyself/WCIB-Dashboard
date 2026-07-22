import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type {
  ActiveMfaMethodType,
  MfaMethodSummary,
  MfaState,
} from "../../shared/mfa-scaffold.js";
import {
  userMfaMethods,
  userMfaRecoveryCodes,
  userMfaSettings,
} from "../db/schema.js";
import type { AuthDatabase } from "./users.js";

export interface MfaAccessState {
  activeMethodCount: number;
  enrolled: boolean;
  enrollmentIncomplete: boolean;
  enforcementEnabled: boolean;
  policyRequired: boolean;
  recoveryCodesAcknowledged: boolean;
  requiresMfaLogin: boolean;
}

export async function ensureMfaSettings(
  database: AuthDatabase,
  userId: string,
): Promise<void> {
  await database
    .insert(userMfaSettings)
    .values({ userId })
    .onConflictDoNothing();
}

export async function loadMfaAccessState(
  database: AuthDatabase,
  userId: string,
  options: { adminEnforcementEnabled: boolean; isAdmin: boolean },
): Promise<MfaAccessState> {
  const [settings] = await database
    .select({
      enforcementEnabled: userMfaSettings.enforcementEnabled,
      enrollmentCompletedAt: userMfaSettings.enrollmentCompletedAt,
      policyRequiredAt: userMfaSettings.policyRequiredAt,
      recoveryCodesAcknowledgedAt:
        userMfaSettings.recoveryCodesAcknowledgedAt,
    })
    .from(userMfaSettings)
    .where(eq(userMfaSettings.userId, userId))
    .limit(1);
  const methods = await loadActiveMethods(database, userId);
  const activeMethodCount = methods.length;
  const recoveryCodeHistory = await database
    .select({ id: userMfaRecoveryCodes.id })
    .from(userMfaRecoveryCodes)
    .where(eq(userMfaRecoveryCodes.userId, userId))
    .limit(1);
  const recoveryCodesAcknowledged =
    settings?.recoveryCodesAcknowledgedAt !== null &&
    settings?.recoveryCodesAcknowledgedAt !== undefined;
  const enrolled =
    activeMethodCount > 0 &&
    settings?.enrollmentCompletedAt !== null &&
    settings?.enrollmentCompletedAt !== undefined &&
    recoveryCodesAcknowledged;
  const enforcementEnabled = settings?.enforcementEnabled === true;
  const enrollmentIncomplete = enforcementEnabled && !enrolled;
  const policyRequired =
    (options.adminEnforcementEnabled && options.isAdmin) ||
    (settings?.policyRequiredAt !== null &&
      settings?.policyRequiredAt !== undefined);

  return {
    activeMethodCount,
    enrolled,
    enrollmentIncomplete,
    enforcementEnabled,
    policyRequired,
    recoveryCodesAcknowledged,
    requiresMfaLogin:
      enforcementEnabled &&
      (activeMethodCount > 0 || recoveryCodeHistory.length > 0),
  };
}

export async function loadMfaState(
  database: AuthDatabase,
  userId: string,
  options: { adminEnforcementEnabled: boolean; isAdmin: boolean },
): Promise<MfaState> {
  const access = await loadMfaAccessState(database, userId, options);
  const methods = await loadActiveMethods(database, userId);
  const recoveryCodes = await database
    .select({ id: userMfaRecoveryCodes.id })
    .from(userMfaRecoveryCodes)
    .where(
      and(
        eq(userMfaRecoveryCodes.userId, userId),
        isNull(userMfaRecoveryCodes.consumedAt),
      ),
    );

  return {
    adminEnforcementEnabled: options.adminEnforcementEnabled,
    adminRecommended: options.isAdmin && !access.enrolled,
    enrolled: access.enrolled,
    enrollmentRequired:
      !access.enrolled &&
      (access.policyRequired || access.enrollmentIncomplete),
    methods,
    recoveryCodesAcknowledged: access.recoveryCodesAcknowledged,
    recoveryCodesRemaining: recoveryCodes.length,
  };
}

async function loadActiveMethods(
  database: AuthDatabase,
  userId: string,
): Promise<MfaMethodSummary[]> {
  const methods = await database
    .select({
      createdAt: userMfaMethods.createdAt,
      id: userMfaMethods.id,
      isPrimary: userMfaMethods.isPrimary,
      label: userMfaMethods.label,
      lastUsedAt: userMfaMethods.lastUsedAt,
      methodType: userMfaMethods.methodType,
    })
    .from(userMfaMethods)
    .where(
      and(
        eq(userMfaMethods.userId, userId),
        inArray(userMfaMethods.methodType, ["webauthn", "totp"]),
        isNotNull(userMfaMethods.verifiedAt),
        isNull(userMfaMethods.disabledAt),
      ),
    )
    .orderBy(userMfaMethods.createdAt, userMfaMethods.id);

  return methods.map((method) => ({
    createdAt: method.createdAt.toISOString(),
    id: method.id,
    isPrimary: method.isPrimary,
    label: method.label,
    lastUsedAt: method.lastUsedAt?.toISOString() ?? null,
    methodType: method.methodType as ActiveMfaMethodType,
  }));
}
