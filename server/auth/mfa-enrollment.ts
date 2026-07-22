import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { AuthorizedRequestContext } from "./authorization.js";
import { writeMfaAudit } from "./mfa-audit.js";
import { replaceRecoveryCodesInTransaction } from "./mfa-recovery.js";
import { incrementSessionVersion } from "./mfa-totp.js";
import {
  mfaRecoveryGrants,
  userMfaMethods,
  userMfaSettings,
} from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import type { AuthDatabase, UserAccount } from "./users.js";

export async function acknowledgeRecoveryCodes(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  recoveryGrantId: string | undefined,
  logger: AppLogger,
  now = new Date(),
): Promise<UserAccount> {
  return database.transaction(async (transaction) => {
    const methods = await transaction
      .select({ id: userMfaMethods.id })
      .from(userMfaMethods)
      .where(
        and(
          eq(userMfaMethods.userId, context.principal.userId),
          inArray(userMfaMethods.methodType, ["totp", "webauthn"]),
          isNotNull(userMfaMethods.verifiedAt),
          isNull(userMfaMethods.disabledAt),
        ),
      );
    if (methods.length === 0) {
      throw new Error("An active MFA method is required");
    }
    const [settings] = await transaction
      .select({
        enrollmentCompletedAt: userMfaSettings.enrollmentCompletedAt,
      })
      .from(userMfaSettings)
      .where(eq(userMfaSettings.userId, context.principal.userId))
      .for("update")
      .limit(1);
    if (settings === undefined) throw new Error("MFA settings were not found");
    await transaction
      .update(userMfaSettings)
      .set({
        enforcementEnabled: true,
        enrollmentCompletedAt: settings.enrollmentCompletedAt ?? now,
        recoveryCodesAcknowledgedAt: now,
        updatedAt: now,
      })
      .where(eq(userMfaSettings.userId, context.principal.userId));
    if (recoveryGrantId !== undefined) {
      await transaction
        .update(mfaRecoveryGrants)
        .set({ consumedAt: now })
        .where(
          and(
            eq(mfaRecoveryGrants.id, recoveryGrantId),
            eq(mfaRecoveryGrants.userId, context.principal.userId),
            isNull(mfaRecoveryGrants.consumedAt),
          ),
        );
    }
    const user = await incrementSessionVersion(
      transaction as AuthDatabase,
      context.principal.userId,
    );
    if (settings.enrollmentCompletedAt === null) {
      await writeMfaAudit(
        transaction as AuthDatabase,
        context,
        { action: "user_mfa_enrolled", outcome: "success" },
        logger,
      );
    }
    return user;
  });
}

export async function regenerateRecoveryCodes(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  logger: AppLogger,
): Promise<{ codes: string[]; user: UserAccount }> {
  return database.transaction(async (transaction) => {
    const recovery = await replaceRecoveryCodesInTransaction(
      transaction as AuthDatabase,
      context.principal.userId,
    );
    const user = await incrementSessionVersion(
      transaction as AuthDatabase,
      context.principal.userId,
    );
    await writeMfaAudit(
      transaction as AuthDatabase,
      context,
      {
        action: "user_mfa_recovery_codes_regenerated",
        recoveryCodesRemaining: recovery.codes.length,
      },
      logger,
    );
    return { codes: recovery.codes, user };
  });
}
