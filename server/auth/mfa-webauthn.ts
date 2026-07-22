import { timingSafeEqual, randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { mfaMethodLabelSchema } from "../../shared/mfa-scaffold.js";
import type { MfaConfig } from "../config/mfa.js";
import {
  mfaChallenges,
  userMfaMethods,
  userMfaSettings,
  userWebAuthnCredentialTransports,
  userWebAuthnCredentials,
} from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import type { AuthorizedRequestContext } from "./authorization.js";
import { writeMfaAudit } from "./mfa-audit.js";
import { hashMfaValue } from "./mfa-crypto.js";
import { replaceRecoveryCodesInTransaction } from "./mfa-recovery.js";
import { ensureMfaSettings } from "./mfa-state.js";
import {
  incrementSessionVersion,
  InvalidMfaChallengeError,
  type MfaEnrollmentResult,
} from "./mfa-totp.js";
import type { AuthDatabase, UserAccount } from "./users.js";

const CHALLENGE_TTL_MS = 5 * 60 * 1_000;
const CEREMONY_TIMEOUT_MS = 60_000;

type WebAuthnPurpose =
  | "webauthn_authentication"
  | "step_up_webauthn";

export interface WebAuthnOptions<TOptions> {
  challengeId: string;
  expiresAt: Date;
  options: TOptions;
}

export interface StepUpChallengeBinding {
  actionType: string;
  mutationDigest: string;
  sessionIdHash: string;
  sessionVersion: number;
  targetUserId: string;
}

export interface VerifiedWebAuthnAuthentication {
  binding: StepUpChallengeBinding | null;
  methodId: string;
}

export async function startWebAuthnRegistration(
  database: AuthDatabase,
  user: Pick<UserAccount, "displayName" | "email" | "id">,
  config: MfaConfig["webAuthn"],
  now = new Date(),
): Promise<WebAuthnOptions<PublicKeyCredentialCreationOptionsJSON>> {
  await ensureMfaSettings(database, user.id);
  const existing = await loadWebAuthnCredentials(database, user.id);
  const challenge = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  const [row] = await database
    .insert(mfaChallenges)
    .values({
      challengeHash: hashMfaValue(challenge),
      expiresAt,
      purpose: "webauthn_registration",
      userId: user.id,
    })
    .returning({ id: mfaChallenges.id });
  if (row === undefined) throw new Error("WebAuthn challenge was not created");
  const options = await generateRegistrationOptions({
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "discouraged",
      userVerification: "discouraged",
    },
    challenge: Buffer.from(challenge, "base64url"),
    excludeCredentials: existing.map((credential) => ({
      id: credential.credentialId,
      transports: normalizeTransports(credential.transports),
    })),
    rpID: config.rpId,
    rpName: config.rpName,
    timeout: CEREMONY_TIMEOUT_MS,
    userDisplayName: user.displayName,
    userID: Buffer.from(user.id, "utf8"),
    userName: user.email,
  });
  return { challengeId: row.id, expiresAt, options };
}

export async function confirmWebAuthnRegistration(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  input: {
    challengeId: string;
    credential: RegistrationResponseJSON;
    label: string;
  },
  config: MfaConfig["webAuthn"],
  logger: AppLogger,
  now = new Date(),
): Promise<MfaEnrollmentResult> {
  const challenge = await loadChallenge(
    database,
    context.principal.userId,
    input.challengeId,
    "webauthn_registration",
    now,
  );
  if (challenge === null) throw new InvalidMfaChallengeError();
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      expectedChallenge: (received) =>
        challengeMatches(challenge.challengeHash, received),
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      requireUserPresence: true,
      requireUserVerification: false,
      response: input.credential,
    });
  } catch {
    throw new InvalidMfaChallengeError();
  }
  if (!verification.verified || verification.registrationInfo === undefined) {
    throw new InvalidMfaChallengeError();
  }
  const registration = verification.registrationInfo;
  const credential = registration.credential;

  return database.transaction(async (transaction) => {
    const [consumed] = await transaction
      .update(mfaChallenges)
      .set({ consumedAt: now })
      .where(
        and(
          eq(mfaChallenges.id, input.challengeId),
          isNull(mfaChallenges.consumedAt),
          sql`${mfaChallenges.expiresAt} > ${now}`,
        ),
      )
      .returning({ id: mfaChallenges.id });
    if (consumed === undefined) throw new InvalidMfaChallengeError();
    const [duplicate] = await transaction
      .select({ methodId: userWebAuthnCredentials.methodId })
      .from(userWebAuthnCredentials)
      .where(eq(userWebAuthnCredentials.credentialId, credential.id))
      .limit(1);
    if (duplicate !== undefined) throw new InvalidMfaChallengeError();

    const active = await transaction
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
    const firstMethod = active.length === 0;
    const [method] = await transaction
      .insert(userMfaMethods)
      .values({
        isPrimary: firstMethod,
        label: mfaMethodLabelSchema.parse(input.label),
        methodType: "webauthn",
        verifiedAt: now,
        userId: context.principal.userId,
      })
      .returning({ id: userMfaMethods.id });
    if (method === undefined) throw new Error("Passkey method was not created");
    await transaction.insert(userWebAuthnCredentials).values({
      aaguid: registration.aaguid,
      authenticatorAttachment: input.credential.authenticatorAttachment,
      counter: credential.counter,
      credentialBackedUp: registration.credentialBackedUp,
      credentialDeviceType: registration.credentialDeviceType,
      credentialId: credential.id,
      methodId: method.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    });
    const transports = normalizeTransports(credential.transports);
    if (transports !== undefined) {
      await transaction.insert(userWebAuthnCredentialTransports).values(
        transports.map((transport) => ({ methodId: method.id, transport })),
      );
    }

    let recoveryCodes: string[] = [];
    if (firstMethod) {
      recoveryCodes = (
        await replaceRecoveryCodesInTransaction(
          transaction as AuthDatabase,
          context.principal.userId,
        )
      ).codes;
    }
    await transaction
      .update(userMfaSettings)
      .set({ enforcementEnabled: true, updatedAt: now })
      .where(eq(userMfaSettings.userId, context.principal.userId));
    const user = await incrementSessionVersion(
      transaction as AuthDatabase,
      context.principal.userId,
    );
    await writeMfaAudit(
      transaction as AuthDatabase,
      context,
      { action: "user_mfa_method_added", method: "webauthn" },
      logger,
    );
    if (firstMethod) {
      await writeMfaAudit(
        transaction as AuthDatabase,
        context,
        {
          action: "user_mfa_recovery_codes_regenerated",
          method: "webauthn",
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

export async function startWebAuthnAuthentication(
  database: AuthDatabase,
  userId: string,
  purpose: WebAuthnPurpose,
  config: MfaConfig["webAuthn"],
  binding: StepUpChallengeBinding | null = null,
  now = new Date(),
): Promise<WebAuthnOptions<PublicKeyCredentialRequestOptionsJSON> | null> {
  const credentials = await loadWebAuthnCredentials(database, userId);
  if (credentials.length === 0) return null;
  const challenge = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  const [row] = await database
    .insert(mfaChallenges)
    .values({
      actionType: binding?.actionType,
      challengeHash: hashMfaValue(challenge),
      expiresAt,
      mutationDigest: binding?.mutationDigest,
      purpose,
      sessionIdHash: binding?.sessionIdHash,
      sessionVersion: binding?.sessionVersion,
      targetUserId: binding?.targetUserId,
      userId,
    })
    .returning({ id: mfaChallenges.id });
  if (row === undefined) throw new Error("WebAuthn challenge was not created");
  const options = await generateAuthenticationOptions({
    allowCredentials: credentials.map((credential) => ({
      id: credential.credentialId,
      transports: normalizeTransports(credential.transports),
    })),
    challenge: Buffer.from(challenge, "base64url"),
    rpID: config.rpId,
    timeout: CEREMONY_TIMEOUT_MS,
    userVerification: "discouraged",
  });
  return { challengeId: row.id, expiresAt, options };
}

export async function verifyWebAuthnAuthentication(
  database: AuthDatabase,
  userId: string,
  input: {
    challengeId: string;
    credential: AuthenticationResponseJSON;
    purpose: WebAuthnPurpose;
  },
  config: MfaConfig["webAuthn"],
  now = new Date(),
): Promise<VerifiedWebAuthnAuthentication | null> {
  const challenge = await loadChallenge(
    database,
    userId,
    input.challengeId,
    input.purpose,
    now,
  );
  if (challenge === null) return null;
  const [credential] = await database
    .select({
      counter: userWebAuthnCredentials.counter,
      credentialId: userWebAuthnCredentials.credentialId,
      methodId: userWebAuthnCredentials.methodId,
      publicKey: userWebAuthnCredentials.publicKey,
    })
    .from(userWebAuthnCredentials)
    .innerJoin(
      userMfaMethods,
      eq(userMfaMethods.id, userWebAuthnCredentials.methodId),
    )
    .where(
      and(
        eq(userMfaMethods.userId, userId),
        eq(userMfaMethods.methodType, "webauthn"),
        eq(userWebAuthnCredentials.credentialId, input.credential.id),
        isNotNull(userMfaMethods.verifiedAt),
        isNull(userMfaMethods.disabledAt),
      ),
    )
    .limit(1);
  if (credential === undefined) return null;
  const transportRows = await database
    .select({ transport: userWebAuthnCredentialTransports.transport })
    .from(userWebAuthnCredentialTransports)
    .where(eq(userWebAuthnCredentialTransports.methodId, credential.methodId));

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      credential: {
        counter: credential.counter,
        id: credential.credentialId,
        publicKey: Buffer.from(credential.publicKey, "base64url"),
        transports: normalizeTransports(
          transportRows.map(({ transport }) => transport),
        ),
      },
      expectedChallenge: (received) =>
        challengeMatches(challenge.challengeHash, received),
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      requireUserVerification: false,
      response: input.credential,
    });
  } catch {
    return null;
  }
  if (!verification.verified || verification.authenticationInfo === undefined) {
    return null;
  }
  const nextCounter = verification.authenticationInfo.newCounter;
  if (credential.counter > 0 && nextCounter <= credential.counter) return null;

  return database.transaction(async (transaction) => {
    const [consumed] = await transaction
      .update(mfaChallenges)
      .set({ consumedAt: now })
      .where(
        and(
          eq(mfaChallenges.id, input.challengeId),
          isNull(mfaChallenges.consumedAt),
          sql`${mfaChallenges.expiresAt} > ${now}`,
        ),
      )
      .returning({ id: mfaChallenges.id });
    if (consumed === undefined) return null;
    const [updated] = await transaction
      .update(userWebAuthnCredentials)
      .set({ counter: nextCounter, updatedAt: now })
      .where(
        and(
          eq(userWebAuthnCredentials.methodId, credential.methodId),
          eq(userWebAuthnCredentials.counter, credential.counter),
        ),
      )
      .returning({ methodId: userWebAuthnCredentials.methodId });
    if (updated === undefined) return null;
    await transaction
      .update(userMfaMethods)
      .set({ lastUsedAt: now, updatedAt: now })
      .where(eq(userMfaMethods.id, credential.methodId));
    return {
      binding:
        challenge.actionType === null ||
        challenge.mutationDigest === null ||
        challenge.sessionIdHash === null ||
        challenge.sessionVersion === null ||
        challenge.targetUserId === null
          ? null
          : {
              actionType: challenge.actionType,
              mutationDigest: challenge.mutationDigest,
              sessionIdHash: challenge.sessionIdHash,
              sessionVersion: challenge.sessionVersion,
              targetUserId: challenge.targetUserId,
            },
      methodId: credential.methodId,
    };
  });
}

async function loadChallenge(
  database: AuthDatabase,
  userId: string,
  challengeId: string,
  purpose: string,
  now: Date,
) {
  const [challenge] = await database
    .select({
      actionType: mfaChallenges.actionType,
      challengeHash: mfaChallenges.challengeHash,
      mutationDigest: mfaChallenges.mutationDigest,
      sessionIdHash: mfaChallenges.sessionIdHash,
      sessionVersion: mfaChallenges.sessionVersion,
      targetUserId: mfaChallenges.targetUserId,
    })
    .from(mfaChallenges)
    .where(
      and(
        eq(mfaChallenges.id, challengeId),
        eq(mfaChallenges.userId, userId),
        eq(mfaChallenges.purpose, purpose),
        isNull(mfaChallenges.consumedAt),
        sql`${mfaChallenges.expiresAt} > ${now}`,
      ),
    )
    .limit(1);
  return challenge ?? null;
}

async function loadWebAuthnCredentials(
  database: AuthDatabase,
  userId: string,
) {
  const credentials = await database
    .select({
      credentialId: userWebAuthnCredentials.credentialId,
      methodId: userWebAuthnCredentials.methodId,
    })
    .from(userWebAuthnCredentials)
    .innerJoin(
      userMfaMethods,
      eq(userMfaMethods.id, userWebAuthnCredentials.methodId),
    )
    .where(
      and(
        eq(userMfaMethods.userId, userId),
        eq(userMfaMethods.methodType, "webauthn"),
        isNotNull(userMfaMethods.verifiedAt),
        isNull(userMfaMethods.disabledAt),
      ),
    );
  if (credentials.length === 0) return [];
  const transports = await database
    .select({
      methodId: userWebAuthnCredentialTransports.methodId,
      transport: userWebAuthnCredentialTransports.transport,
    })
    .from(userWebAuthnCredentialTransports)
    .where(
      inArray(
        userWebAuthnCredentialTransports.methodId,
        credentials.map(({ methodId }) => methodId),
      ),
    );
  return credentials.map((credential) => ({
    credentialId: credential.credentialId,
    transports: transports
      .filter(({ methodId }) => methodId === credential.methodId)
      .map(({ transport }) => transport),
  }));
}

function challengeMatches(expectedHash: string, received: string): boolean {
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(hashMfaValue(received), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function normalizeTransports(
  transports: readonly string[] | null | undefined,
): AuthenticatorTransportFuture[] | undefined {
  const normalized = (transports ?? []).filter(
    (transport): transport is AuthenticatorTransportFuture =>
      transport === "ble" ||
      transport === "cable" ||
      transport === "hybrid" ||
      transport === "internal" ||
      transport === "nfc" ||
      transport === "smart-card" ||
      transport === "usb",
  );
  return normalized.length === 0 ? undefined : normalized;
}

export type WebAuthnRegistrationCredential = RegistrationResponseJSON;
export type WebAuthnAuthenticationCredential = AuthenticationResponseJSON;
export type WebAuthnTransport = AuthenticatorTransportFuture;
