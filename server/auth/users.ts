import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  createUserCredentialsSchema,
  userEmailSchema,
} from "../../shared/user-credentials.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import * as databaseSchema from "../db/schema.js";
import { users } from "../db/schema.js";
import {
  hashPassword,
  hashAuthenticatedPasswordForUpgrade,
  passwordHashNeedsUpgrade,
} from "./password.js";

export type AuthDatabase = NodePgDatabase<typeof databaseSchema>;

const accountSelection = {
  createdAt: users.createdAt,
  displayName: users.displayName,
  email: users.email,
  id: users.id,
  isActive: users.isActive,
  passwordChangeRequiredAt: users.passwordChangeRequiredAt,
  sessionVersion: users.sessionVersion,
};

export interface UserAccount {
  createdAt: Date;
  displayName: string;
  email: string;
  id: string;
  isActive: boolean;
  passwordChangeRequiredAt: Date | null;
  sessionVersion: number;
}

export interface UserCredentials {
  account: UserAccount;
  passwordHash: string;
}

export class DuplicateUserEmailError extends Error {
  readonly code = "duplicate_user_email";

  constructor() {
    super("An account already uses that email");
    this.name = "DuplicateUserEmailError";
  }
}

export async function createUser(
  database: AuthDatabase,
  input: unknown,
): Promise<UserAccount> {
  const credentials = createUserInputSchema.parse(input);
  const passwordHash = await hashPassword(credentials.password);

  try {
    const [account] = await database
      .insert(users)
      .values({
        displayName:
          credentials.displayName ?? defaultDisplayName(credentials.email),
        email: credentials.email,
        passwordChangeRequiredAt: credentials.passwordChangeRequired
          ? new Date()
          : null,
        passwordHash,
      })
      .returning(accountSelection);

    if (account === undefined) {
      throw new Error("User creation returned no account");
    }
    return account;
  } catch (error) {
    if (readDatabaseErrorCode(error) === "23505") {
      throw new DuplicateUserEmailError();
    }
    throw error;
  }
}

export async function opportunisticallyUpgradePasswordHash(
  database: AuthDatabase,
  userId: string,
  password: string,
  currentPasswordHash: string,
): Promise<boolean> {
  if (!passwordHashNeedsUpgrade(currentPasswordHash)) {
    return false;
  }
  const replacement = await hashAuthenticatedPasswordForUpgrade(password);
  if (replacement === null) {
    return false;
  }
  const [updated] = await database
    .update(users)
    .set({ passwordHash: replacement })
    .where(
      and(
        eq(users.id, userId),
        eq(users.passwordHash, currentPasswordHash),
      ),
    )
    .returning({ id: users.id });
  return updated !== undefined;
}

export async function findUserById(
  database: AuthDatabase,
  id: string,
): Promise<UserAccount | null> {
  const [account] = await database
    .select(accountSelection)
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return account ?? null;
}

export async function findUserByEmail(
  database: AuthDatabase,
  email: string,
): Promise<UserAccount | null> {
  const normalizedEmail = userEmailSchema.safeParse(email);
  if (!normalizedEmail.success) {
    return null;
  }

  const [account] = await database
    .select(accountSelection)
    .from(users)
    .where(eq(users.email, normalizedEmail.data))
    .limit(1);
  return account ?? null;
}

export async function findUserCredentialsByEmail(
  database: AuthDatabase,
  email: string,
): Promise<UserCredentials | null> {
  const normalizedEmail = userEmailSchema.safeParse(email);
  if (!normalizedEmail.success) {
    return null;
  }

  const [record] = await database
    .select({ ...accountSelection, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, normalizedEmail.data))
    .limit(1);

  if (record === undefined) {
    return null;
  }

  const { passwordHash, ...account } = record;
  return { account, passwordHash };
}

const createUserInputSchema = createUserCredentialsSchema.extend({
  displayName: z.string().trim().min(1).max(200).optional(),
  passwordChangeRequired: z.boolean().optional().default(false),
});

function defaultDisplayName(email: string): string {
  return email.split("@", 1)[0] ?? email;
}
