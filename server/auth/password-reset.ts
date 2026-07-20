import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type {
  PasswordResetConfirm,
  PasswordResetRequest,
} from "../../shared/password-reset.js";
import {
  passwordResetTokens,
  sessions,
  users,
} from "../db/schema.js";
import { hashPassword, verifyPassword } from "./password.js";
import type { PasswordResetDelivery } from "./password-reset-delivery.js";
import { findUserByEmail, type AuthDatabase } from "./users.js";

export const PASSWORD_RESET_TOKEN_BYTES = 32;
export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1_000;

export type PasswordResetRequestResult =
  | { status: "not_issued" }
  | { status: "delivered" }
  | { status: "delivery_failed" };

export interface PasswordResetOptions {
  clock?: () => Date;
  randomBytes?: (size: number) => Buffer;
}

class InvalidPasswordResetTokenError extends Error {}

export function createPasswordResetToken(
  randomBytesImpl: (size: number) => Buffer = randomBytes,
): string {
  return randomBytesImpl(PASSWORD_RESET_TOKEN_BYTES).toString("base64url");
}

export function hashPasswordResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function requestPasswordReset(
  database: AuthDatabase,
  request: PasswordResetRequest,
  delivery: PasswordResetDelivery,
  options: PasswordResetOptions = {},
): Promise<PasswordResetRequestResult> {
  const user = await findUserByEmail(database, request.email);
  if (user === null || !user.isActive) {
    return { status: "not_issued" };
  }

  const now = options.clock?.() ?? new Date();
  const token = createPasswordResetToken(options.randomBytes);
  const tokenHash = hashPasswordResetToken(token);
  const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TOKEN_TTL_MS);

  await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`select ${users.id} from ${users} where ${users.id} = ${user.id} for update`,
    );
    await transaction
      .update(passwordResetTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          isNull(passwordResetTokens.consumedAt),
        ),
      );
    await transaction.insert(passwordResetTokens).values({
      createdAt: now,
      expiresAt,
      tokenHash,
      userId: user.id,
    });
  });

  try {
    await delivery.send({ email: user.email, expiresAt, token });
    return { status: "delivered" };
  } catch {
    await database
      .update(passwordResetTokens)
      .set({ consumedAt: options.clock?.() ?? new Date() })
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          isNull(passwordResetTokens.consumedAt),
        ),
      );
    return { status: "delivery_failed" };
  }
}

export async function confirmPasswordReset(
  database: AuthDatabase,
  request: PasswordResetConfirm,
  options: Pick<PasswordResetOptions, "clock"> = {},
): Promise<boolean> {
  const now = options.clock?.() ?? new Date();
  const tokenHash = hashPasswordResetToken(request.token);
  const passwordHash = await hashPassword(request.password);

  try {
    return await database.transaction(async (transaction) => {
      const [token] = await transaction
        .update(passwordResetTokens)
        .set({ consumedAt: now })
        .where(
          and(
            eq(passwordResetTokens.tokenHash, tokenHash),
            isNull(passwordResetTokens.consumedAt),
            gt(passwordResetTokens.expiresAt, now),
          ),
        )
        .returning({ userId: passwordResetTokens.userId });

      if (token === undefined) {
        throw new InvalidPasswordResetTokenError();
      }

      const [currentUser] = await transaction
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(and(eq(users.id, token.userId), eq(users.isActive, true)))
        .for("update")
        .limit(1);
      if (
        currentUser === undefined ||
        (await verifyPassword(request.password, currentUser.passwordHash))
      ) {
        throw new InvalidPasswordResetTokenError();
      }

      const [updatedUser] = await transaction
        .update(users)
        .set({
          passwordChangeRequiredAt: null,
          passwordHash,
          sessionVersion: sql`${users.sessionVersion} + 1`,
        })
        .where(and(eq(users.id, token.userId), eq(users.isActive, true)))
        .returning({ id: users.id });

      if (updatedUser === undefined) {
        return false;
      }

      await transaction
        .update(passwordResetTokens)
        .set({ consumedAt: now })
        .where(
          and(
            eq(passwordResetTokens.userId, token.userId),
            isNull(passwordResetTokens.consumedAt),
          ),
        );
      await transaction
        .delete(sessions)
        .where(sql`${sessions.sess}->>'userId' = ${token.userId}`);

      return true;
    });
  } catch (error) {
    if (error instanceof InvalidPasswordResetTokenError) {
      return false;
    }
    throw error;
  }
}
