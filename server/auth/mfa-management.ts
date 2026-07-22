import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { mfaMethodLabelSchema } from "../../shared/mfa-scaffold.js";
import {
  mfaChallenges,
  mfaRecoveryGrants,
  mfaStepUpAuthorizations,
  userMfaMethods,
  userMfaRecoveryCodes,
  userMfaSettings,
} from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import type { AuthorizedRequestContext } from "./authorization.js";
import { writeMfaAudit } from "./mfa-audit.js";
import { incrementSessionVersion } from "./mfa-totp.js";
import {
  consumeStepUpAuthorization,
  type StepUpProof,
} from "./mfa-step-up.js";
import type { AuthDatabase, UserAccount } from "./users.js";

export class MfaPolicyRequiredError extends Error {
  constructor() {
    super("MFA is required by account policy");
    this.name = "MfaPolicyRequiredError";
  }
}

export class MfaMethodNotFoundError extends Error {
  constructor() {
    super("MFA method was not found");
    this.name = "MfaMethodNotFoundError";
  }
}

export class LastMfaMethodError extends Error {
  constructor() {
    super("Use Turn off MFA to remove the final security method");
    this.name = "LastMfaMethodError";
  }
}

export async function renameOwnMfaMethod(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  methodId: string,
  labelInput: string,
  logger: AppLogger,
  now = new Date(),
): Promise<void> {
  const label = mfaMethodLabelSchema.parse(labelInput);
  await database.transaction(async (transaction) => {
    const [method] = await transaction
      .select({
        label: userMfaMethods.label,
        methodType: userMfaMethods.methodType,
      })
      .from(userMfaMethods)
      .where(
        and(
          eq(userMfaMethods.id, methodId),
          eq(userMfaMethods.userId, context.principal.userId),
          inArray(userMfaMethods.methodType, ["totp", "webauthn"]),
          isNotNull(userMfaMethods.verifiedAt),
          isNull(userMfaMethods.disabledAt),
        ),
      )
      .for("update")
      .limit(1);
    if (method === undefined) throw new MfaMethodNotFoundError();
    if (method.label === label) return;

    await transaction
      .update(userMfaMethods)
      .set({ label, updatedAt: now })
      .where(eq(userMfaMethods.id, methodId));
    if (method.methodType === "totp" || method.methodType === "webauthn") {
      await writeMfaAudit(
        transaction as AuthDatabase,
        context,
        {
          action: "user_mfa_method_renamed",
          method: method.methodType,
          methodId,
        },
        logger,
      );
    }
  });
}

export async function removeOwnMfaMethod(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  methodId: string,
  proof: Omit<StepUpProof, "descriptor">,
  logger: AppLogger,
  now = new Date(),
): Promise<UserAccount> {
  return database.transaction(async (transaction) => {
    const descriptor = {
      action: "mfa_disable" as const,
      mutation: { methodId },
      targetUserId: context.principal.userId,
    };
    await consumeStepUpAuthorization(
      transaction as AuthDatabase,
      context,
      { ...proof, descriptor },
      now,
    );
    const methods = await transaction
      .select({
        createdAt: userMfaMethods.createdAt,
        id: userMfaMethods.id,
        isPrimary: userMfaMethods.isPrimary,
        methodType: userMfaMethods.methodType,
      })
      .from(userMfaMethods)
      .where(
        and(
          eq(userMfaMethods.userId, context.principal.userId),
          inArray(userMfaMethods.methodType, ["totp", "webauthn"]),
          isNotNull(userMfaMethods.verifiedAt),
          isNull(userMfaMethods.disabledAt),
        ),
      )
      .orderBy(asc(userMfaMethods.createdAt), asc(userMfaMethods.id))
      .for("update");
    const method = methods.find(({ id }) => id === methodId);
    if (method === undefined) throw new MfaMethodNotFoundError();
    if (methods.length === 1) throw new LastMfaMethodError();

    await transaction
      .update(userMfaMethods)
      .set({ disabledAt: now, isPrimary: false, updatedAt: now })
      .where(eq(userMfaMethods.id, methodId));
    if (method.isPrimary) {
      const replacement = methods.find(({ id }) => id !== methodId);
      if (replacement === undefined) throw new LastMfaMethodError();
      await transaction
        .update(userMfaMethods)
        .set({ isPrimary: true, updatedAt: now })
        .where(eq(userMfaMethods.id, replacement.id));
    }
    const user = await incrementSessionVersion(
      transaction as AuthDatabase,
      context.principal.userId,
    );
    if (method.methodType === "totp" || method.methodType === "webauthn") {
      await writeMfaAudit(
        transaction as AuthDatabase,
        context,
        {
          action: "user_mfa_method_removed",
          method: method.methodType,
          methodId,
        },
        logger,
      );
    }
    return user;
  });
}

export async function disableOwnMfa(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  proof: StepUpProof,
  options: { adminEnforcementEnabled: boolean; isAdmin: boolean },
  logger: AppLogger,
  now = new Date(),
): Promise<UserAccount> {
  if (options.adminEnforcementEnabled && options.isAdmin) {
    throw new MfaPolicyRequiredError();
  }
  return database.transaction(async (transaction) => {
    await consumeStepUpAuthorization(
      transaction as AuthDatabase,
      context,
      proof,
      now,
    );
    const methods = await transaction
      .select({ methodType: userMfaMethods.methodType })
      .from(userMfaMethods)
      .where(
        and(
          eq(userMfaMethods.userId, context.principal.userId),
          inArray(userMfaMethods.methodType, ["totp", "webauthn"]),
          isNotNull(userMfaMethods.verifiedAt),
          isNull(userMfaMethods.disabledAt),
        ),
      );
    await transaction
      .update(userMfaMethods)
      .set({ disabledAt: now, isPrimary: false, updatedAt: now })
      .where(
        and(
          eq(userMfaMethods.userId, context.principal.userId),
          isNull(userMfaMethods.disabledAt),
        ),
      );
    await transaction
      .update(userMfaSettings)
      .set({
        enforcementEnabled: false,
        enrollmentCompletedAt: null,
        policyRequiredAt: null,
        recoveryCodesAcknowledgedAt: null,
        updatedAt: now,
      })
      .where(eq(userMfaSettings.userId, context.principal.userId));
    await transaction
      .delete(userMfaRecoveryCodes)
      .where(eq(userMfaRecoveryCodes.userId, context.principal.userId));
    await transaction
      .delete(mfaChallenges)
      .where(eq(mfaChallenges.userId, context.principal.userId));
    await transaction
      .delete(mfaRecoveryGrants)
      .where(eq(mfaRecoveryGrants.userId, context.principal.userId));
    await transaction
      .delete(mfaStepUpAuthorizations)
      .where(
        and(
          eq(mfaStepUpAuthorizations.userId, context.principal.userId),
          isNull(mfaStepUpAuthorizations.consumedAt),
        ),
      );
    const user = await incrementSessionVersion(
      transaction as AuthDatabase,
      context.principal.userId,
    );
    for (const method of methods) {
      if (method.methodType === "totp" || method.methodType === "webauthn") {
        await writeMfaAudit(
          transaction as AuthDatabase,
          context,
          { action: "user_mfa_method_removed", method: method.methodType },
          logger,
        );
      }
    }
    await writeMfaAudit(
      transaction as AuthDatabase,
      context,
      { action: "user_mfa_disabled", outcome: "success" },
      logger,
    );
    return user;
  });
}
