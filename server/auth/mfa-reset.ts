import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { resetAdminMfaRequestSchema } from "../../shared/admin-account-security.js";
import type { AccessRequirement } from "./access.js";
import { evaluateAccess } from "./access.js";
import type { AuthorizedRequestContext } from "./authorization.js";
import {
  mfaChallenges,
  mfaRecoveryGrants,
  mfaStepUpAuthorizations,
  userMfaMethods,
  userMfaRecoveryCodes,
  userMfaSettings,
  users,
} from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import { writeMfaAudit } from "./mfa-audit.js";
import {
  consumeStepUpAuthorization,
  type StepUpProof,
} from "./mfa-step-up.js";
import { incrementSessionVersion } from "./mfa-totp.js";
import type { AuthDatabase } from "./users.js";

export const MFA_RESET_ACCESS = {
  capabilities: ["admin", "support_engineer"],
} as const satisfies AccessRequirement;

export class MfaResetAccessDeniedError extends Error {
  constructor() {
    super("MFA reset access denied");
    this.name = "MfaResetAccessDeniedError";
  }
}

export class MfaResetConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MfaResetConflictError";
  }
}

export class MfaResetNotFoundError extends Error {
  constructor() {
    super("Account was not found");
    this.name = "MfaResetNotFoundError";
  }
}

export async function resetUserMfa(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  targetUserId: string,
  rawInput: unknown,
  proof: StepUpProof,
  logger: AppLogger,
  now = new Date(),
): Promise<void> {
  if (!evaluateAccess(context.principal, MFA_RESET_ACCESS).allowed) {
    throw new MfaResetAccessDeniedError();
  }
  const input = resetAdminMfaRequestSchema.parse(rawInput);
  if (targetUserId === context.principal.userId) {
    throw new MfaResetConflictError(
      "Another administrator must reset your MFA",
    );
  }
  await database.transaction(async (transaction) => {
    const stepUpMethod = await consumeStepUpAuthorization(
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
    if (target === undefined) throw new MfaResetNotFoundError();

    const methods = await transaction
      .select({ methodType: userMfaMethods.methodType })
      .from(userMfaMethods)
      .where(
        and(
          eq(userMfaMethods.userId, targetUserId),
          isNotNull(userMfaMethods.verifiedAt),
          isNull(userMfaMethods.disabledAt),
        ),
      );
    await transaction
      .update(userMfaMethods)
      .set({ disabledAt: now, isPrimary: false, updatedAt: now })
      .where(
        and(
          eq(userMfaMethods.userId, targetUserId),
          isNull(userMfaMethods.disabledAt),
        ),
      );
    await transaction
      .delete(userMfaRecoveryCodes)
      .where(eq(userMfaRecoveryCodes.userId, targetUserId));
    await transaction
      .delete(mfaChallenges)
      .where(eq(mfaChallenges.userId, targetUserId));
    await transaction
      .delete(mfaRecoveryGrants)
      .where(eq(mfaRecoveryGrants.userId, targetUserId));
    await transaction
      .delete(mfaStepUpAuthorizations)
      .where(eq(mfaStepUpAuthorizations.userId, targetUserId));
    await transaction
      .insert(userMfaSettings)
      .values({ userId: targetUserId })
      .onConflictDoNothing();
    await transaction
      .update(userMfaSettings)
      .set({
        enforcementEnabled: true,
        enrollmentCompletedAt: null,
        policyRequiredAt: now,
        recoveryCodesAcknowledgedAt: null,
        updatedAt: now,
      })
      .where(eq(userMfaSettings.userId, targetUserId));
    await incrementSessionVersion(transaction as AuthDatabase, targetUserId);

    for (const method of methods) {
      if (method.methodType === "totp" || method.methodType === "webauthn") {
        await writeMfaAudit(
          transaction as AuthDatabase,
          context,
          {
            action: "user_mfa_method_removed",
            method: method.methodType,
            targetUserId,
          },
          logger,
        );
      }
    }
    await writeMfaAudit(
      transaction as AuthDatabase,
      context,
      {
        action: "user_mfa_reset",
        method: stepUpMethod,
        outcome: "success",
        reason: input.reason,
        targetUserId,
      },
      logger,
    );
  });
}
