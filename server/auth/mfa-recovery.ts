import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { MFA_RECOVERY_CODE_COUNT } from "../../shared/mfa-scaffold.js";
import {
  mfaRecoveryGrants,
  sessions,
  userMfaMethods,
  userMfaRecoveryCodes,
  userMfaSettings,
  users,
} from "../db/schema.js";
import { hashMfaValue } from "./mfa-crypto.js";
import { writeMfaAudit } from "./mfa-audit.js";
import { hashOpaqueSecret, verifyOpaqueSecret } from "./password.js";
import type { AppLogger } from "../logging/logger.js";
import type { AuthorizedRequestContext } from "./authorization.js";
import type { AuthDatabase, UserAccount } from "./users.js";

const RECOVERY_GRANT_TTL_MS = 15 * 60 * 1_000;
const RECOVERY_CODE_PREFIX = "WCIB";

export interface RecoveryCodeSet {
  codes: string[];
}

export interface RecoveryGrantResult {
  grantId: string;
  recoveryCodesRemaining: number;
  user: UserAccount;
}

export async function replaceRecoveryCodesInTransaction(
  transaction: AuthDatabase,
  userId: string,
): Promise<RecoveryCodeSet> {
  const codes = Array.from(
    { length: MFA_RECOVERY_CODE_COUNT },
    () => formatRecoveryCode(randomBytes(16).toString("hex").toUpperCase()),
  );
  const rows = [];
  for (const code of codes) {
    rows.push({
      codeHash: await hashOpaqueSecret(normalizeRecoveryCode(code)),
      lookupPrefix: recoveryLookupPrefix(code),
      userId,
    });
  }
  await transaction
    .delete(userMfaRecoveryCodes)
    .where(eq(userMfaRecoveryCodes.userId, userId));
  await transaction.insert(userMfaRecoveryCodes).values(rows);
  await transaction
    .update(userMfaSettings)
    .set({ recoveryCodesAcknowledgedAt: null, updatedAt: new Date() })
    .where(eq(userMfaSettings.userId, userId));
  return { codes };
}

export async function consumeRecoveryCode(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  rawCode: string,
  sessionId: string,
  logger: AppLogger,
): Promise<RecoveryGrantResult | null> {
  const userId = context.principal.userId;
  const normalized = normalizeRecoveryCode(rawCode);
  const lookupPrefix = recoveryLookupPrefix(normalized);
  return database.transaction(async (transaction) => {
    const [code] = await transaction
      .select({
        codeHash: userMfaRecoveryCodes.codeHash,
        id: userMfaRecoveryCodes.id,
      })
      .from(userMfaRecoveryCodes)
      .where(
        and(
          eq(userMfaRecoveryCodes.userId, userId),
          eq(userMfaRecoveryCodes.lookupPrefix, lookupPrefix),
          isNull(userMfaRecoveryCodes.consumedAt),
        ),
      )
      .for("update")
      .limit(1);
    if (code === undefined || !(await verifyOpaqueSecret(normalized, code.codeHash))) {
      return null;
    }

    const now = new Date();
    const [consumed] = await transaction
      .update(userMfaRecoveryCodes)
      .set({ consumedAt: now })
      .where(
        and(
          eq(userMfaRecoveryCodes.id, code.id),
          isNull(userMfaRecoveryCodes.consumedAt),
        ),
      )
      .returning({ id: userMfaRecoveryCodes.id });
    if (consumed === undefined) return null;

    const methods = await transaction
      .select({ methodType: userMfaMethods.methodType })
      .from(userMfaMethods)
      .where(
        and(
          eq(userMfaMethods.userId, userId),
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
          eq(userMfaMethods.userId, userId),
          isNull(userMfaMethods.disabledAt),
        ),
      );
    await transaction
      .update(userMfaSettings)
      .set({
        enforcementEnabled: true,
        enrollmentCompletedAt: null,
        recoveryCodesAcknowledgedAt: null,
        updatedAt: now,
      })
      .where(eq(userMfaSettings.userId, userId));
    const [user] = await transaction
      .update(users)
      .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, userId))
      .returning({
        createdAt: users.createdAt,
        displayName: users.displayName,
        email: users.email,
        id: users.id,
        isActive: users.isActive,
        passwordChangeRequiredAt: users.passwordChangeRequiredAt,
        sessionVersion: users.sessionVersion,
      });
    if (user === undefined) throw new Error("Recovery user was not found");
    await transaction
      .delete(sessions)
      .where(sql`${sessions.sess}->>'userId' = ${userId}`);
    const [grant] = await transaction
      .insert(mfaRecoveryGrants)
      .values({
        expiresAt: new Date(now.getTime() + RECOVERY_GRANT_TTL_MS),
        sessionIdHash: hashMfaValue(sessionId),
        userId,
      })
      .returning({ id: mfaRecoveryGrants.id });
    if (grant === undefined) throw new Error("Recovery grant was not created");
    const remaining = await transaction
      .select({ id: userMfaRecoveryCodes.id })
      .from(userMfaRecoveryCodes)
      .where(
        and(
          eq(userMfaRecoveryCodes.userId, userId),
          isNull(userMfaRecoveryCodes.consumedAt),
        ),
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
      {
        action: "user_mfa_recovery_code_used",
        method: "recovery_code",
        recoveryCodesRemaining: remaining.length,
      },
      logger,
    );
    return {
      grantId: grant.id,
      recoveryCodesRemaining: remaining.length,
      user,
    };
  });
}

export async function validateRecoveryGrant(
  database: AuthDatabase,
  userId: string,
  grantId: string | undefined,
  sessionId: string,
): Promise<boolean> {
  if (grantId === undefined) return false;
  const [grant] = await database
    .select({ id: mfaRecoveryGrants.id })
    .from(mfaRecoveryGrants)
    .where(
      and(
        eq(mfaRecoveryGrants.id, grantId),
        eq(mfaRecoveryGrants.userId, userId),
        eq(mfaRecoveryGrants.sessionIdHash, hashMfaValue(sessionId)),
        isNull(mfaRecoveryGrants.consumedAt),
        sql`${mfaRecoveryGrants.expiresAt} > now()`,
      ),
    )
    .limit(1);
  return grant !== undefined;
}

export function normalizeRecoveryCode(value: string): string {
  return value.trim().toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
}

export function recoveryLookupPrefix(value: string): string {
  const normalized = normalizeRecoveryCode(value);
  const payload = normalized.startsWith(RECOVERY_CODE_PREFIX)
    ? normalized.slice(RECOVERY_CODE_PREFIX.length)
    : normalized;
  return payload.slice(0, 10);
}

function formatRecoveryCode(hex: string): string {
  return `${RECOVERY_CODE_PREFIX}-${hex.match(/.{1,8}/g)?.join("-") ?? hex}`;
}
