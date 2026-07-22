import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  updateAdminAccountEmailRequestSchema,
  updateAdminCapabilityRequestSchema,
  type AdminAccountSecurityItem,
} from "../../shared/admin-account-security.js";
import { writeAuditEventInDrizzleTransaction } from "../audit/event.js";
import {
  staffProfiles,
  userCapabilities,
  userMfaSettings,
  users,
} from "../db/schema.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import type { AppLogger } from "../logging/logger.js";
import type { AuthorizedRequestContext } from "./authorization.js";
import { writeMfaAudit } from "./mfa-audit.js";
import {
  MfaResetConflictError,
  MfaResetNotFoundError,
  resetUserMfa,
} from "./mfa-reset.js";
import { loadMfaState } from "./mfa-state.js";
import {
  consumeStepUpAuthorization,
  type StepUpProof,
} from "./mfa-step-up.js";
import { incrementSessionVersion } from "./mfa-totp.js";
import type { AuthDatabase } from "./users.js";

export const ADMIN_ACCOUNT_SECURITY_ACCESS = {
  capabilities: ["admin"],
} as const;

const adminCapabilities = alias(userCapabilities, "account_security_admin");
const supportCapabilities = alias(
  userCapabilities,
  "account_security_support",
);

export class AdminAccountSecurityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminAccountSecurityConflictError";
  }
}

export class AdminAccountSecurityNotFoundError extends Error {
  constructor() {
    super("Account was not found");
    this.name = "AdminAccountSecurityNotFoundError";
  }
}

export async function listAdminAccountSecurity(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  adminEnforcementEnabled: boolean,
  allUsersEnforcementEnabled = false,
): Promise<AdminAccountSecurityItem[]> {
  requireAdmin(context);
  const accounts = await database
    .select({
      adminCapability: adminCapabilities.isActive,
      displayName: users.displayName,
      email: users.email,
      id: users.id,
      isActive: users.isActive,
      staffRole: staffProfiles.role,
      supportCapability: supportCapabilities.isActive,
    })
    .from(users)
    .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id))
    .leftJoin(
      adminCapabilities,
      and(
        eq(adminCapabilities.userId, users.id),
        eq(adminCapabilities.capability, "admin"),
      ),
    )
    .leftJoin(
      supportCapabilities,
      and(
        eq(supportCapabilities.userId, users.id),
        eq(supportCapabilities.capability, "support_engineer"),
      ),
    )
    .orderBy(users.displayName, users.id);
  const result: AdminAccountSecurityItem[] = [];
  for (const account of accounts) {
    const isAdmin = account.adminCapability === true;
    const mfa = await loadMfaState(database, account.id, {
      adminEnforcementEnabled,
      allUsersEnforcementEnabled,
      isAdmin,
    });
    result.push({
      adminCapability: isAdmin,
      displayName: account.displayName,
      email: account.email,
      id: account.id,
      isActive: account.isActive,
      mfa: {
        enrolled: mfa.enrolled,
        enrollmentRequired: mfa.enrollmentRequired,
        methods: mfa.methods.map((method) => method.methodType),
        recoveryCodesRemaining: mfa.recoveryCodesRemaining,
      },
      staffRole: account.staffRole,
      supportCapability: account.supportCapability === true,
    });
  }
  return result;
}

export async function setSupportCapability(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  targetUserId: string,
  rawInput: unknown,
  proof: StepUpProof,
  adminEnforcementEnabled: boolean,
  allUsersEnforcementEnabled: boolean,
  logger: AppLogger,
  now = new Date(),
): Promise<void> {
  requireAdmin(context);
  const input = updateAdminCapabilityRequestSchema.parse(rawInput);
  await database.transaction(async (transaction) => {
    await consumeStepUpAuthorization(
      transaction as AuthDatabase,
      context,
      proof,
      now,
    );
    const [target] = await transaction
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, targetUserId))
      .for("update")
      .limit(1);
    if (target === undefined) throw new AdminAccountSecurityNotFoundError();
    if (input.enabled) {
      const [profile] = await transaction
        .select({ userId: staffProfiles.userId })
        .from(staffProfiles)
        .where(eq(staffProfiles.userId, targetUserId))
        .limit(1);
      if (profile !== undefined) {
        throw new AdminAccountSecurityConflictError(
          "Support capability requires a capability-only account",
        );
      }
    }
    await transaction
      .insert(userCapabilities)
      .values({
        capability: "support_engineer",
        isActive: input.enabled,
        userId: targetUserId,
      })
      .onConflictDoUpdate({
        set: { isActive: input.enabled },
        target: [userCapabilities.userId, userCapabilities.capability],
      });
    const [adminCapability] = await transaction
      .select({ isActive: userCapabilities.isActive })
      .from(userCapabilities)
      .where(
        and(
          eq(userCapabilities.userId, targetUserId),
          eq(userCapabilities.capability, "admin"),
        ),
      )
      .limit(1);
    const policyRequired =
      input.enabled ||
      allUsersEnforcementEnabled ||
      (adminEnforcementEnabled && adminCapability?.isActive === true);
    await transaction
      .insert(userMfaSettings)
      .values({ userId: targetUserId })
      .onConflictDoNothing();
    await transaction
      .update(userMfaSettings)
      .set({
        ...(input.enabled ? { enforcementEnabled: true } : {}),
        policyRequiredAt: policyRequired ? now : null,
        updatedAt: now,
      })
      .where(eq(userMfaSettings.userId, targetUserId));
    await incrementSessionVersion(transaction as AuthDatabase, targetUserId);
    await writeMfaAudit(
      transaction as AuthDatabase,
      context,
      {
        action: "user_support_capability_changed",
        actionType: input.enabled ? "enabled" : "disabled",
        targetUserId,
      },
      logger,
    );
  });
}

export async function setAdminCapability(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  targetUserId: string,
  rawInput: unknown,
  proof: StepUpProof,
  adminEnforcementEnabled: boolean,
  logger: AppLogger,
): Promise<void> {
  requireAdmin(context);
  const input = updateAdminCapabilityRequestSchema.parse(rawInput);
  if (targetUserId === context.principal.userId && !input.enabled) {
    throw new AdminAccountSecurityConflictError(
      "Administrators cannot remove their own recovery capability",
    );
  }
  await database.transaction(async (transaction) => {
    await consumeStepUpAuthorization(
      transaction as AuthDatabase,
      context,
      proof,
    );
    const [target] = await transaction
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, targetUserId))
      .for("update")
      .limit(1);
    if (target === undefined) throw new AdminAccountSecurityNotFoundError();
    if (!input.enabled) {
      const activeAdmins = await transaction
        .select({ userId: userCapabilities.userId })
        .from(userCapabilities)
        .where(
          and(
            eq(userCapabilities.capability, "admin"),
            eq(userCapabilities.isActive, true),
          ),
        );
      if (activeAdmins.length <= 1) {
        throw new AdminAccountSecurityConflictError(
          "At least one active administrator must remain",
        );
      }
    }
    await transaction
      .insert(userCapabilities)
      .values({
        capability: "admin",
        isActive: input.enabled,
        userId: targetUserId,
      })
      .onConflictDoUpdate({
        set: { isActive: input.enabled },
        target: [userCapabilities.userId, userCapabilities.capability],
      });
    await transaction
      .insert(userMfaSettings)
      .values({ userId: targetUserId })
      .onConflictDoNothing();
    await transaction
      .update(userMfaSettings)
      .set({
        policyRequiredAt:
          input.enabled && adminEnforcementEnabled ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(userMfaSettings.userId, targetUserId));
    await incrementSessionVersion(transaction as AuthDatabase, targetUserId);
    await writeMfaAudit(
      transaction as AuthDatabase,
      context,
      {
        action: "user_admin_capability_changed",
        actionType: input.enabled ? "enabled" : "disabled",
        outcome: "success",
        targetUserId,
      },
      logger,
    );
  });
}

export async function updateAdminAccountEmail(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  targetUserId: string,
  rawInput: unknown,
  proof: StepUpProof,
  logger: AppLogger,
): Promise<void> {
  requireAdmin(context);
  const input = updateAdminAccountEmailRequestSchema.parse(rawInput);
  try {
    await database.transaction(async (transaction) => {
      await consumeStepUpAuthorization(
        transaction as AuthDatabase,
        context,
        proof,
      );
      const [updated] = await transaction
        .update(users)
        .set({ email: input.email })
        .where(eq(users.id, targetUserId))
        .returning({ id: users.id });
      if (updated === undefined) throw new AdminAccountSecurityNotFoundError();
      await incrementSessionVersion(transaction as AuthDatabase, targetUserId);
      await writeAuditEventInDrizzleTransaction(
        transaction,
        context,
        {
          action: "user_profile_changed",
          after: {
            allowedFields: ["changeKind"],
            source: { changeKind: "admin_email_change" },
          },
          entityId: targetUserId,
          entityType: "user",
        },
        logger,
      );
    });
  } catch (error) {
    if (readDatabaseErrorCode(error) === "23505") {
      throw new AdminAccountSecurityConflictError(
        "Another account already uses that email",
      );
    }
    throw error;
  }
}

export async function resetAdminMfa(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  targetUserId: string,
  rawInput: unknown,
  proof: StepUpProof,
  logger: AppLogger,
  now = new Date(),
): Promise<void> {
  requireAdmin(context);
  try {
    await resetUserMfa(
      database,
      context,
      targetUserId,
      rawInput,
      proof,
      logger,
      now,
    );
  } catch (error) {
    if (error instanceof MfaResetNotFoundError) {
      throw new AdminAccountSecurityNotFoundError();
    }
    if (error instanceof MfaResetConflictError) {
      throw new AdminAccountSecurityConflictError(error.message);
    }
    throw error;
  }
}

function requireAdmin(context: AuthorizedRequestContext): void {
  if (
    !context.principal.userActive ||
    !context.principal.capabilities.includes("admin")
  ) {
    throw new Error("Administrator capability is required");
  }
}
