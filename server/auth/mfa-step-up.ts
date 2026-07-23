import { randomBytes, createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type {
  ActiveMfaMethodType,
  MfaStepUpDescriptor,
} from "../../shared/mfa-scaffold.js";
import { mfaStepUpDescriptorSchema } from "../../shared/mfa-scaffold.js";
import { mfaStepUpAuthorizations, users } from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import type { AuthorizedRequestContext } from "./authorization.js";
import { writeMfaAudit } from "./mfa-audit.js";
import { hashMfaValue } from "./mfa-crypto.js";
import { verifyPassword } from "./password.js";
import type { AuthDatabase } from "./users.js";

const STEP_UP_TTL_MS = 5 * 60 * 1_000;

export interface StepUpSessionBinding {
  sessionId: string;
  sessionVersion: number;
}

export interface StepUpAuthorizationResult {
  expiresAt: Date;
  token: string;
}

export interface StepUpProof extends StepUpSessionBinding {
  descriptor: MfaStepUpDescriptor;
  token: string | undefined;
}

export class StepUpRequiredError extends Error {
  constructor() {
    super("A matching MFA step-up authorization is required");
    this.name = "StepUpRequiredError";
  }
}

export async function verifyStepUpPassword(
  database: AuthDatabase,
  userId: string,
  currentPassword: string,
): Promise<boolean> {
  const [credentials] = await database
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isActive, true)))
    .limit(1);
  return (
    credentials !== undefined &&
    verifyPassword(currentPassword, credentials.passwordHash)
  );
}

export async function issueStepUpAuthorization(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  descriptorInput: unknown,
  binding: StepUpSessionBinding,
  method: ActiveMfaMethodType,
  logger: AppLogger,
  now = new Date(),
): Promise<StepUpAuthorizationResult> {
  const descriptor = mfaStepUpDescriptorSchema.parse(descriptorInput);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + STEP_UP_TTL_MS);
  await database.transaction(async (transaction) => {
    await transaction.insert(mfaStepUpAuthorizations).values({
      actionType: descriptor.action,
      expiresAt,
      methodType: method,
      mutationDigest: mutationDigest(descriptor.mutation),
      sessionIdHash: hashMfaValue(binding.sessionId),
      sessionVersion: binding.sessionVersion,
      targetUserId: descriptor.targetUserId,
      tokenHash: hashMfaValue(token),
      userId: context.principal.userId,
    });
    await writeMfaAudit(
      transaction as AuthDatabase,
      context,
      {
        action: "user_mfa_step_up_succeeded",
        actionType: descriptor.action,
        method,
        outcome: "success",
        targetUserId: descriptor.targetUserId,
      },
      logger,
    );
  });
  return { expiresAt, token };
}

export async function recordStepUpFailure(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  descriptorInput: unknown,
  method: ActiveMfaMethodType,
  reason: string,
  logger: AppLogger,
): Promise<void> {
  const descriptor = mfaStepUpDescriptorSchema.parse(descriptorInput);
  await database.transaction(async (transaction) => {
    await writeMfaAudit(
      transaction as AuthDatabase,
      context,
      {
        action: "user_mfa_step_up_failed",
        actionType: descriptor.action,
        method,
        outcome: "failure",
        reason,
        targetUserId: descriptor.targetUserId,
      },
      logger,
    );
  });
}

export async function consumeStepUpAuthorization(
  transaction: AuthDatabase,
  context: AuthorizedRequestContext,
  proof: StepUpProof,
  now = new Date(),
): Promise<ActiveMfaMethodType> {
  const descriptor = mfaStepUpDescriptorSchema.parse(proof.descriptor);
  if (proof.token === undefined || proof.token.length === 0) {
    throw new StepUpRequiredError();
  }
  const [consumed] = await transaction
    .update(mfaStepUpAuthorizations)
    .set({ consumedAt: now })
    .where(
      and(
        eq(mfaStepUpAuthorizations.userId, context.principal.userId),
        eq(
          mfaStepUpAuthorizations.sessionIdHash,
          hashMfaValue(proof.sessionId),
        ),
        eq(mfaStepUpAuthorizations.sessionVersion, proof.sessionVersion),
        eq(mfaStepUpAuthorizations.actionType, descriptor.action),
        eq(mfaStepUpAuthorizations.targetUserId, descriptor.targetUserId),
        eq(
          mfaStepUpAuthorizations.mutationDigest,
          mutationDigest(descriptor.mutation),
        ),
        eq(mfaStepUpAuthorizations.tokenHash, hashMfaValue(proof.token)),
        isNull(mfaStepUpAuthorizations.consumedAt),
        sql`${mfaStepUpAuthorizations.expiresAt} > ${now}`,
      ),
    )
    .returning({ method: mfaStepUpAuthorizations.methodType });
  if (consumed === undefined) throw new StepUpRequiredError();
  if (consumed.method !== "totp" && consumed.method !== "webauthn") {
    throw new StepUpRequiredError();
  }
  return consumed.method;
}

export function mutationDigest(mutation: Readonly<Record<string, unknown>>): string {
  return createHash("sha256")
    .update(canonicalJson(mutation))
    .digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
