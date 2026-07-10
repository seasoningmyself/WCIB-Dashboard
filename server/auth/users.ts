import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  createUserCredentialsSchema,
  userEmailSchema,
} from "../../shared/user-credentials.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import * as databaseSchema from "../db/schema.js";
import { users } from "../db/schema.js";
import { hashPassword } from "./password.js";

export type AuthDatabase = NodePgDatabase<typeof databaseSchema>;

const accountSelection = {
  createdAt: users.createdAt,
  email: users.email,
  id: users.id,
  isActive: users.isActive,
  sessionVersion: users.sessionVersion,
};

export interface UserAccount {
  createdAt: Date;
  email: string;
  id: string;
  isActive: boolean;
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
  const credentials = createUserCredentialsSchema.parse(input);
  const passwordHash = await hashPassword(credentials.password);

  try {
    const [account] = await database
      .insert(users)
      .values({ email: credentials.email, passwordHash })
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
