import { and, asc, eq, sql } from "drizzle-orm";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import { staffProfiles, users } from "../db/schema.js";
import type {
  DraftAssignmentOption,
  DraftAssignmentOptionsResponse,
} from "../../shared/draft-assignment-options.js";

export async function listDraftAssignmentOptions(
  database: AuthDatabase,
): Promise<DraftAssignmentOption[]> {
  return database
    .select({
      displayName: staffProfiles.displayName,
      userId: staffProfiles.userId,
    })
    .from(staffProfiles)
    .innerJoin(users, eq(users.id, staffProfiles.userId))
    .where(
      and(
        eq(staffProfiles.role, "producer"),
        eq(staffProfiles.isActive, true),
        eq(users.isActive, true),
      ),
    )
    .orderBy(
      asc(sql`lower(${staffProfiles.displayName})`),
      asc(staffProfiles.userId),
    );
}

export function projectDraftAssignmentOptions(
  producers: readonly DraftAssignmentOption[],
  context: AuthorizedRequestContext,
): DraftAssignmentOptionsResponse | null {
  const { principal } = context;
  const hasTurnInRole =
    principal.capabilities.includes("admin") ||
    principal.staffRole === "employee" ||
    principal.staffRole === "producer";
  if (!principal.userActive || !hasTurnInRole) {
    return null;
  }
  return {
    producers: producers.map(({ displayName, userId }) => ({
      displayName,
      userId,
    })),
  };
}
