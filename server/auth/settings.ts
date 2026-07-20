import { eq } from "drizzle-orm";
import {
  ownSettingsResponseSchema,
  updateOwnProfileRequestSchema,
  type OwnSettingsResponse,
} from "../../shared/account-settings.js";
import { writeAuditEventInDrizzleTransaction } from "../audit/event.js";
import { officeLocations, staffProfiles, users } from "../db/schema.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import type { AppLogger } from "../logging/logger.js";
import type { AuthorizedRequestContext } from "./authorization.js";
import type { AuthDatabase } from "./users.js";

const PROFILE_AUDIT_FIELDS = ["displayNameChanged"] as const;

export interface OwnSettingsSource {
  displayName: string;
  email: string;
  officeLocation: {
    id: string;
    isActive: boolean;
    name: string;
  } | null;
  userId: string;
}

export class OwnSettingsConflictError extends Error {
  constructor() {
    super("That display name is already in use");
    this.name = "OwnSettingsConflictError";
  }
}

export class OwnSettingsNotFoundError extends Error {
  constructor() {
    super("Account settings were not found");
    this.name = "OwnSettingsNotFoundError";
  }
}

export async function loadOwnSettings(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
): Promise<OwnSettingsSource> {
  const userId = context.principal.userId;
  const [row] = await database
    .select({
      displayName: users.displayName,
      email: users.email,
      officeId: officeLocations.id,
      officeIsActive: officeLocations.isActive,
      officeName: officeLocations.name,
      userId: users.id,
    })
    .from(users)
    .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id))
    .leftJoin(
      officeLocations,
      eq(officeLocations.id, staffProfiles.officeLocationId),
    )
    .where(eq(users.id, userId))
    .limit(1);
  if (row === undefined) {
    throw new OwnSettingsNotFoundError();
  }
  return {
    displayName: row.displayName,
    email: row.email,
    officeLocation:
      row.officeId === null ||
      row.officeIsActive === null ||
      row.officeName === null
        ? null
        : {
            id: row.officeId,
            isActive: row.officeIsActive,
            name: row.officeName,
          },
    userId: row.userId,
  };
}

export async function updateOwnProfile(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  rawInput: unknown,
  logger: AppLogger,
): Promise<OwnSettingsSource> {
  const input = updateOwnProfileRequestSchema.parse(rawInput);
  const userId = context.principal.userId;
  try {
    await database.transaction(async (transaction) => {
      const [current] = await transaction
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, userId))
        .for("update")
        .limit(1);
      if (current === undefined) {
        throw new OwnSettingsNotFoundError();
      }
      if (current.displayName === input.displayName) {
        return;
      }
      await transaction
        .update(users)
        .set({ displayName: input.displayName })
        .where(eq(users.id, userId));
      await writeAuditEventInDrizzleTransaction(
        transaction,
        context,
        {
          action: "user_profile_changed",
          after: {
            allowedFields: PROFILE_AUDIT_FIELDS,
            source: { displayNameChanged: true },
          },
          entityId: userId,
          entityType: "user",
        },
        logger,
      );
    });
  } catch (error) {
    if (readDatabaseErrorCode(error) === "23505") {
      throw new OwnSettingsConflictError();
    }
    throw error;
  }
  return loadOwnSettings(database, context);
}

export function projectOwnSettings(
  source: Readonly<OwnSettingsSource>,
  context: AuthorizedRequestContext,
): OwnSettingsResponse | null {
  if (
    !context.principal.userActive ||
    context.principal.userId !== source.userId
  ) {
    return null;
  }
  return ownSettingsResponseSchema.parse({
    settings: {
      displayName: source.displayName,
      email: source.email,
      officeLocation: source.officeLocation,
    },
  });
}
