import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { passwordSchema } from "../../shared/password-policy.js";
import { userEmailSchema } from "../../shared/user-credentials.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import {
  staffProfiles,
  userCapabilities,
  type StaffProfileRecord,
} from "../db/schema.js";
import {
  createUser,
  DuplicateUserEmailError,
  findUserByEmail,
  type AuthDatabase,
  type UserAccount,
} from "./users.js";

export const INITIAL_ROSTER = [
  {
    displayName: "Kaylee",
    key: "kaylee",
    staff: { role: "producer" },
  },
  {
    displayName: "Mercedes",
    key: "mercedes",
    staff: { role: "employee" },
  },
  {
    displayName: "Daniela",
    key: "daniela",
    staff: { role: "employee" },
  },
  {
    displayName: "Joseph",
    key: "joseph",
    staff: { role: "employee" },
  },
  {
    displayName: "Ellyscia",
    key: "ellyscia",
    staff: { role: "employee" },
  },
  { capability: "admin", displayName: "Sophia", key: "sophia" },
] as const;

export const INITIAL_ROSTER_ENV = "WCIB_SEED_ROSTER_JSON";

type InitialRosterMember = (typeof INITIAL_ROSTER)[number];
type InitialRosterKey = InitialRosterMember["key"];

const seedCredentialSchema = z
  .object({
    email: userEmailSchema,
    password: passwordSchema,
  })
  .strict();

const initialRosterCredentialsSchema = z
  .object({
    daniela: seedCredentialSchema,
    ellyscia: seedCredentialSchema,
    joseph: seedCredentialSchema,
    kaylee: seedCredentialSchema,
    mercedes: seedCredentialSchema,
    sophia: seedCredentialSchema,
  })
  .strict()
  .superRefine((credentials, context) => {
    const emails = new Set<string>();
    const passwords = new Set<string>();

    for (const member of INITIAL_ROSTER) {
      const credential = credentials[member.key];
      if (emails.has(credential.email)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Each roster account must use a unique email",
          path: [member.key, "email"],
        });
      }
      if (passwords.has(credential.password)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Each roster account must use a unique temporary password",
          path: [member.key, "password"],
        });
      }
      emails.add(credential.email);
      passwords.add(credential.password);
    }
  });

export type InitialRosterCredentials = z.output<
  typeof initialRosterCredentialsSchema
>;

export interface SeedCount {
  created: number;
  skipped: number;
}

export interface InitialRosterSeedResult {
  capabilities: SeedCount;
  staffProfiles: SeedCount;
  users: SeedCount;
}

export class InitialRosterConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InitialRosterConfigError";
  }
}

export class InitialRosterConflictError extends Error {
  constructor(displayName: string, detail: string) {
    super(`${displayName}: ${detail}`);
    this.name = "InitialRosterConflictError";
  }
}

export function parseInitialRosterCredentials(
  value: string | undefined,
): InitialRosterCredentials {
  if (value === undefined || value.trim() === "") {
    throw new InitialRosterConfigError(`${INITIAL_ROSTER_ENV} is required`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new InitialRosterConfigError(
      `${INITIAL_ROSTER_ENV} must be valid JSON`,
    );
  }

  const result = initialRosterCredentialsSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .slice(0, 20)
      .map((issue) => `${issue.path.join(".") || "roster"}: ${issue.message}`)
      .join("; ");
    throw new InitialRosterConfigError(
      `${INITIAL_ROSTER_ENV} is invalid: ${details}`,
    );
  }
  return result.data;
}

export async function seedInitialRoster(
  database: AuthDatabase,
  credentials: InitialRosterCredentials,
): Promise<InitialRosterSeedResult> {
  const existingAccounts = await loadExistingAccounts(database, credentials);
  const existingProfiles = await database.select().from(staffProfiles);
  await assertExistingRecordsAreSafe(
    database,
    existingAccounts,
    existingProfiles,
  );

  const result: InitialRosterSeedResult = {
    capabilities: { created: 0, skipped: 0 },
    staffProfiles: { created: 0, skipped: 0 },
    users: { created: 0, skipped: 0 },
  };
  const accounts = {} as Record<InitialRosterKey, UserAccount>;

  for (const member of INITIAL_ROSTER) {
    const existing = existingAccounts[member.key];
    if (existing !== undefined) {
      accounts[member.key] = existing;
      result.users.skipped += 1;
      continue;
    }

    try {
      accounts[member.key] = await createUser(
        database,
        credentials[member.key],
      );
      result.users.created += 1;
    } catch (error) {
      if (!(error instanceof DuplicateUserEmailError)) {
        throw error;
      }
      const concurrent = await findUserByEmail(
        database,
        credentials[member.key].email,
      );
      if (concurrent === null) {
        throw error;
      }
      assertAccountIsActive(member, concurrent);
      accounts[member.key] = concurrent;
      result.users.skipped += 1;
    }
  }

  for (const member of INITIAL_ROSTER) {
    const account = accounts[member.key];
    if ("staff" in member) {
      const [created] = await database
        .insert(staffProfiles)
        .values({
          displayName: member.displayName,
          role: member.staff.role,
          userId: account.id,
        })
        .onConflictDoNothing()
        .returning({ userId: staffProfiles.userId });
      if (created === undefined) {
        result.staffProfiles.skipped += 1;
      } else {
        result.staffProfiles.created += 1;
      }
      continue;
    }

    const [created] = await database
      .insert(userCapabilities)
      .values({ capability: member.capability, userId: account.id })
      .onConflictDoNothing()
      .returning({ userId: userCapabilities.userId });
    if (created === undefined) {
      result.capabilities.skipped += 1;
    } else {
      result.capabilities.created += 1;
    }
  }

  await assertSeededRoster(database, accounts);
  return result;
}

export function formatInitialRosterSeedResult(
  result: InitialRosterSeedResult,
): string {
  return [
    `users created ${result.users.created}, skipped ${result.users.skipped}`,
    `staff profiles created ${result.staffProfiles.created}, skipped ${result.staffProfiles.skipped}`,
    `capabilities created ${result.capabilities.created}, skipped ${result.capabilities.skipped}`,
  ].join("; ");
}

export function formatInitialRosterSeedError(error: unknown): string {
  if (
    error instanceof InitialRosterConfigError ||
    error instanceof InitialRosterConflictError
  ) {
    return error.message;
  }
  const code = readDatabaseErrorCode(error);
  return code === undefined
    ? "Initial roster seed failed"
    : `Initial roster seed failed (${code})`;
}

async function loadExistingAccounts(
  database: AuthDatabase,
  credentials: InitialRosterCredentials,
): Promise<Partial<Record<InitialRosterKey, UserAccount>>> {
  const accounts: Partial<Record<InitialRosterKey, UserAccount>> = {};
  for (const member of INITIAL_ROSTER) {
    const account = await findUserByEmail(
      database,
      credentials[member.key].email,
    );
    if (account !== null) {
      accounts[member.key] = account;
    }
  }
  return accounts;
}

async function assertExistingRecordsAreSafe(
  database: AuthDatabase,
  accounts: Partial<Record<InitialRosterKey, UserAccount>>,
  profiles: readonly StaffProfileRecord[],
): Promise<void> {
  for (const member of INITIAL_ROSTER) {
    const account = accounts[member.key];
    if (account !== undefined) {
      assertAccountIsActive(member, account);
    }
    const namedProfiles = profiles.filter(
      (profile) =>
        profile.displayName.toLowerCase() === member.displayName.toLowerCase(),
    );

    if (!("staff" in member)) {
      if (
        namedProfiles.length > 0 ||
        (account !== undefined &&
          profiles.some((profile) => profile.userId === account.id))
      ) {
        throw new InitialRosterConflictError(
          member.displayName,
          "admin account must not have a staff profile",
        );
      }
      if (account !== undefined) {
        const [capability] = await database
          .select({ isActive: userCapabilities.isActive })
          .from(userCapabilities)
          .where(
            and(
              eq(userCapabilities.userId, account.id),
              eq(userCapabilities.capability, member.capability),
            ),
          )
          .limit(1);
        if (capability?.isActive === false) {
          throw new InitialRosterConflictError(
            member.displayName,
            "admin capability is disabled and will not be reactivated by seed",
          );
        }
      }
      continue;
    }

    if (
      namedProfiles.length > 1 ||
      (namedProfiles[0] !== undefined &&
        namedProfiles[0].userId !== account?.id)
    ) {
      throw new InitialRosterConflictError(
        member.displayName,
        "display name belongs to a different staff identity",
      );
    }
    if (account === undefined) {
      continue;
    }
    const profile = profiles.find((entry) => entry.userId === account.id);
    if (profile !== undefined && !matchesStaffMember(profile, member)) {
      throw new InitialRosterConflictError(
        member.displayName,
        "existing staff profile differs from the approved roster",
      );
    }
  }
}

function assertAccountIsActive(
  member: InitialRosterMember,
  account: UserAccount,
): void {
  if (!account.isActive) {
    throw new InitialRosterConflictError(
      member.displayName,
      "existing account is disabled and will not be reactivated by seed",
    );
  }
}

function matchesStaffMember(
  profile: StaffProfileRecord,
  member: Extract<InitialRosterMember, { staff: unknown }>,
): boolean {
  return (
    profile.displayName === member.displayName &&
    profile.role === member.staff.role &&
    profile.isActive
  );
}

async function assertSeededRoster(
  database: AuthDatabase,
  accounts: Record<InitialRosterKey, UserAccount>,
): Promise<void> {
  const profiles = await database.select().from(staffProfiles);
  for (const member of INITIAL_ROSTER) {
    const profile = profiles.find(
      (entry) => entry.userId === accounts[member.key].id,
    );
    if ("staff" in member) {
      if (profile === undefined || !matchesStaffMember(profile, member)) {
        throw new InitialRosterConflictError(
          member.displayName,
          "staff profile was not seeded as approved",
        );
      }
    } else if (profile !== undefined) {
      throw new InitialRosterConflictError(
        member.displayName,
        "admin account must not have a staff profile",
      );
    }
  }

  const sophia = INITIAL_ROSTER[5];
  const [admin] = await database
    .select({ isActive: userCapabilities.isActive })
    .from(userCapabilities)
    .where(
      and(
        eq(userCapabilities.userId, accounts.sophia.id),
        eq(userCapabilities.capability, sophia.capability),
      ),
    )
    .limit(1);
  if (admin?.isActive !== true) {
    throw new InitialRosterConflictError(
      sophia.displayName,
      "active admin capability was not seeded",
    );
  }
}
