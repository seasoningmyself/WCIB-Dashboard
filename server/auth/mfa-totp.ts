import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { generateSecret, generateURI, verifySync } from "otplib";
import type { AuthorizedRequestContext } from "./authorization.js";
import { mfaMethodLabelSchema } from "../../shared/mfa-scaffold.js";
import type { MfaEncryptionKeyRing } from "./mfa-crypto.js";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  mfaSecretContext,
} from "./mfa-crypto.js";
import { writeMfaAudit } from "./mfa-audit.js";
import { ensureMfaSettings } from "./mfa-state.js";
import { replaceRecoveryCodesInTransaction } from "./mfa-recovery.js";
import {
  sessions,
  userMfaMethods,
  userMfaSettings,
  userTotpCredentials,
  users,
} from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import type { AuthDatabase, UserAccount } from "./users.js";

const TOTP_ISSUER = "West Coast Insurance Brokers";
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_ENROLLMENT_TTL_MS = 10 * 60 * 1_000;

export class MfaMethodExistsError extends Error {
  constructor() {
    super("That MFA method is already enrolled");
    this.name = "MfaMethodExistsError";
  }
}

export class InvalidMfaChallengeError extends Error {
  constructor() {
    super("The MFA challenge is invalid or expired");
    this.name = "InvalidMfaChallengeError";
  }
}

export interface TotpEnrollmentStart {
  expiresAt: Date;
  methodId: string;
  otpauthUrl: string;
  secret: string;
}

export interface MfaEnrollmentResult {
  recoveryCodes: string[];
  requiresRecoveryAcknowledgement: boolean;
  user: UserAccount;
}

export async function startTotpEnrollment(
  database: AuthDatabase,
  user: Pick<UserAccount, "email" | "id">,
  labelInput: string,
  keyRing: MfaEncryptionKeyRing,
  now = new Date(),
): Promise<TotpEnrollmentStart> {
  const label = mfaMethodLabelSchema.parse(labelInput);
  const secret = generateSecret({ length: 20 });
  const expiresAt = new Date(now.getTime() + TOTP_ENROLLMENT_TTL_MS);
  return database.transaction(async (transaction) => {
    await ensureMfaSettings(transaction as AuthDatabase, user.id);
    const [existing] = await transaction
      .select({ id: userMfaMethods.id })
      .from(userMfaMethods)
      .where(
        and(
          eq(userMfaMethods.userId, user.id),
          eq(userMfaMethods.methodType, "totp"),
          isNotNull(userMfaMethods.verifiedAt),
          isNull(userMfaMethods.disabledAt),
        ),
      )
      .limit(1);
    if (existing !== undefined) throw new MfaMethodExistsError();
    await transaction
      .delete(userMfaMethods)
      .where(
        and(
          eq(userMfaMethods.userId, user.id),
          eq(userMfaMethods.methodType, "totp"),
          isNull(userMfaMethods.verifiedAt),
        ),
      );
    const [method] = await transaction
      .insert(userMfaMethods)
      .values({
        expiresAt,
        label,
        methodType: "totp",
        userId: user.id,
      })
      .returning({ id: userMfaMethods.id });
    if (method === undefined) throw new Error("TOTP method was not created");
    await transaction.insert(userTotpCredentials).values({
      encryptedSecret: encryptMfaSecret(
        secret,
        mfaSecretContext(user.id, method.id),
        keyRing,
      ),
      methodId: method.id,
    });
    return {
      expiresAt,
      methodId: method.id,
      otpauthUrl: generateURI({
        digits: TOTP_DIGITS,
        issuer: TOTP_ISSUER,
        label: user.email,
        period: TOTP_PERIOD_SECONDS,
        secret,
      }),
      secret,
    };
  });
}

export async function confirmTotpEnrollment(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  methodId: string,
  code: string,
  keyRing: MfaEncryptionKeyRing,
  logger: AppLogger,
  now = new Date(),
): Promise<MfaEnrollmentResult> {
  return database.transaction(async (transaction) => {
    const [record] = await transaction
      .select({
        encryptedSecret: userTotpCredentials.encryptedSecret,
        expiresAt: userMfaMethods.expiresAt,
        userId: userMfaMethods.userId,
        verifiedAt: userMfaMethods.verifiedAt,
      })
      .from(userMfaMethods)
      .innerJoin(
        userTotpCredentials,
        eq(userTotpCredentials.methodId, userMfaMethods.id),
      )
      .where(
        and(
          eq(userMfaMethods.id, methodId),
          eq(userMfaMethods.userId, context.principal.userId),
          eq(userMfaMethods.methodType, "totp"),
          isNull(userMfaMethods.disabledAt),
        ),
      )
      .for("update")
      .limit(1);
    if (
      record === undefined ||
      record.verifiedAt !== null ||
      record.expiresAt === null ||
      record.expiresAt.getTime() <= now.getTime()
    ) {
      throw new InvalidMfaChallengeError();
    }
    const secret = decryptMfaSecret(
      record.encryptedSecret,
      mfaSecretContext(record.userId, methodId),
      keyRing,
    );
    const verification = verifyTotp(secret, code, now);
    if (verification === null) throw new InvalidMfaChallengeError();

    const existingMethods = await transaction
      .select({ id: userMfaMethods.id })
      .from(userMfaMethods)
      .where(
        and(
          eq(userMfaMethods.userId, record.userId),
          inArray(userMfaMethods.methodType, ["totp", "webauthn"]),
          isNotNull(userMfaMethods.verifiedAt),
          isNull(userMfaMethods.disabledAt),
        ),
      );
    const firstMethod = existingMethods.length === 0;
    await transaction
      .update(userMfaMethods)
      .set({
        expiresAt: null,
        isPrimary: firstMethod,
        lastUsedAt: now,
        updatedAt: now,
        verifiedAt: now,
      })
      .where(eq(userMfaMethods.id, methodId));
    await transaction
      .update(userTotpCredentials)
      .set({ lastAcceptedTimeStep: verification.timeStep, updatedAt: now })
      .where(eq(userTotpCredentials.methodId, methodId));

    let recoveryCodes: string[] = [];
    if (firstMethod) {
      recoveryCodes = (
        await replaceRecoveryCodesInTransaction(
          transaction as AuthDatabase,
          record.userId,
        )
      ).codes;
    }
    await transaction
      .update(userMfaSettings)
      .set({ enforcementEnabled: true, updatedAt: now })
      .where(eq(userMfaSettings.userId, record.userId));
    const user = await incrementSessionVersion(
      transaction as AuthDatabase,
      record.userId,
    );
    await writeMfaAudit(
      transaction as AuthDatabase,
      context,
      { action: "user_mfa_method_added", method: "totp" },
      logger,
    );
    if (firstMethod) {
      await writeMfaAudit(
        transaction as AuthDatabase,
        context,
        {
          action: "user_mfa_recovery_codes_regenerated",
          method: "totp",
          recoveryCodesRemaining: recoveryCodes.length,
        },
        logger,
      );
    }
    return {
      recoveryCodes,
      requiresRecoveryAcknowledgement: firstMethod,
      user,
    };
  });
}

export async function verifyTotpForUser(
  database: AuthDatabase,
  userId: string,
  code: string,
  keyRing: MfaEncryptionKeyRing,
  now = new Date(),
): Promise<string | null> {
  return database.transaction(async (transaction) => {
    const [record] = await transaction
      .select({
        encryptedSecret: userTotpCredentials.encryptedSecret,
        lastAcceptedTimeStep: userTotpCredentials.lastAcceptedTimeStep,
        methodId: userMfaMethods.id,
      })
      .from(userMfaMethods)
      .innerJoin(
        userTotpCredentials,
        eq(userTotpCredentials.methodId, userMfaMethods.id),
      )
      .where(
        and(
          eq(userMfaMethods.userId, userId),
          eq(userMfaMethods.methodType, "totp"),
          isNotNull(userMfaMethods.verifiedAt),
          isNull(userMfaMethods.disabledAt),
        ),
      )
      .for("update")
      .limit(1);
    if (record === undefined) return null;
    const secret = decryptMfaSecret(
      record.encryptedSecret,
      mfaSecretContext(userId, record.methodId),
      keyRing,
    );
    const verification = verifyTotp(
      secret,
      code,
      now,
      record.lastAcceptedTimeStep ?? undefined,
    );
    if (verification === null) return null;

    const [accepted] = await transaction
      .update(userTotpCredentials)
      .set({ lastAcceptedTimeStep: verification.timeStep, updatedAt: now })
      .where(
        and(
          eq(userTotpCredentials.methodId, record.methodId),
          record.lastAcceptedTimeStep === null
            ? isNull(userTotpCredentials.lastAcceptedTimeStep)
            : lt(
                userTotpCredentials.lastAcceptedTimeStep,
                verification.timeStep,
              ),
        ),
      )
      .returning({ methodId: userTotpCredentials.methodId });
    if (accepted === undefined) return null;
    await transaction
      .update(userMfaMethods)
      .set({ lastUsedAt: now, updatedAt: now })
      .where(eq(userMfaMethods.id, record.methodId));
    return record.methodId;
  });
}

export async function incrementSessionVersion(
  transaction: AuthDatabase,
  userId: string,
): Promise<UserAccount> {
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
  if (user === undefined) throw new Error("MFA user was not found");
  await transaction
    .delete(sessions)
    .where(sql`${sessions.sess}->>'userId' = ${userId}`);
  return user;
}

function verifyTotp(
  secret: string,
  code: string,
  now: Date,
  afterTimeStep?: number,
): { timeStep: number } | null {
  try {
    const result = verifySync({
      afterTimeStep,
      digits: TOTP_DIGITS,
      epoch: Math.floor(now.getTime() / 1_000),
      epochTolerance: [TOTP_PERIOD_SECONDS, 0],
      period: TOTP_PERIOD_SECONDS,
      secret,
      token: code.trim(),
    });
    return result.valid && "timeStep" in result
      ? { timeStep: result.timeStep }
      : null;
  } catch {
    return null;
  }
}
