import { and, eq, sql } from "drizzle-orm";
import {
  changeOwnPasswordRequestSchema,
  requiredPasswordChangeRequestSchema,
} from "../../shared/account-settings.js";
import { writeAuditEventInDrizzleTransaction } from "../audit/event.js";
import { sessions, users } from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import type { AuthorizedRequestContext } from "./authorization.js";
import { hashPassword, verifyPassword } from "./password.js";
import type { AuthDatabase, UserAccount } from "./users.js";

const PASSWORD_AUDIT_FIELDS = ["changeKind"] as const;

export class InvalidCurrentPasswordError extends Error {
  constructor() {
    super("Current password is incorrect");
    this.name = "InvalidCurrentPasswordError";
  }
}

export class PasswordReuseError extends Error {
  constructor() {
    super("New password must differ from the current password");
    this.name = "PasswordReuseError";
  }
}

export class PasswordChangeNotRequiredError extends Error {
  constructor() {
    super("A required password change is not pending");
    this.name = "PasswordChangeNotRequiredError";
  }
}

export async function replaceRequiredPassword(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  rawInput: unknown,
  logger: AppLogger,
): Promise<UserAccount> {
  const input = requiredPasswordChangeRequestSchema.parse(rawInput);
  return replacePassword(
    database,
    context,
    input.newPassword,
    null,
    "required_first_login",
    logger,
  );
}

export async function changeOwnPassword(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  rawInput: unknown,
  logger: AppLogger,
): Promise<UserAccount> {
  const input = changeOwnPasswordRequestSchema.parse(rawInput);
  return replacePassword(
    database,
    context,
    input.newPassword,
    input.currentPassword,
    "self_service",
    logger,
  );
}

async function replacePassword(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  newPassword: string,
  currentPassword: string | null,
  changeKind: "required_first_login" | "self_service",
  logger: AppLogger,
): Promise<UserAccount> {
  const userId = context.principal.userId;

  return database.transaction(async (transaction) => {
    const [current] = await transaction
      .select({
        createdAt: users.createdAt,
        displayName: users.displayName,
        email: users.email,
        id: users.id,
        isActive: users.isActive,
        passwordChangeRequiredAt: users.passwordChangeRequiredAt,
        passwordHash: users.passwordHash,
        sessionVersion: users.sessionVersion,
      })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.isActive, true)))
      .for("update")
      .limit(1);
    if (current === undefined) {
      throw new InvalidCurrentPasswordError();
    }
    if (
      changeKind === "required_first_login" &&
      current.passwordChangeRequiredAt === null
    ) {
      throw new PasswordChangeNotRequiredError();
    }
    if (
      currentPassword !== null &&
      !(await verifyPassword(currentPassword, current.passwordHash))
    ) {
      throw new InvalidCurrentPasswordError();
    }
    if (await verifyPassword(newPassword, current.passwordHash)) {
      throw new PasswordReuseError();
    }

    const passwordHash = await hashPassword(newPassword);
    const [updated] = await transaction
      .update(users)
      .set({
        passwordChangeRequiredAt: null,
        passwordHash,
        sessionVersion: sql`${users.sessionVersion} + 1`,
      })
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
    if (updated === undefined) {
      throw new Error("Password update returned no account");
    }

    await transaction
      .delete(sessions)
      .where(sql`${sessions.sess}->>'userId' = ${userId}`);
    await writeAuditEventInDrizzleTransaction(
      transaction,
      context,
      {
        action: "user_password_changed",
        after: {
          allowedFields: PASSWORD_AUDIT_FIELDS,
          source: { changeKind },
        },
        entityId: userId,
        entityType: "user",
      },
      logger,
    );

    return updated;
  });
}
