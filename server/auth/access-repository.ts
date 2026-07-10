import { eq } from "drizzle-orm";
import {
  staffProfiles,
  userCapabilities,
  users,
} from "../db/schema.js";
import type { AuthDatabase } from "./users.js";
import {
  buildAccessPrincipal,
  type AccessPrincipal,
} from "./access.js";

export async function loadAccessPrincipal(
  database: AuthDatabase,
  userId: string,
): Promise<AccessPrincipal | null> {
  const [identity] = await database
    .select({
      staffActive: staffProfiles.isActive,
      staffRole: staffProfiles.role,
      userActive: users.isActive,
      userId: users.id,
    })
    .from(users)
    .leftJoin(staffProfiles, eq(users.id, staffProfiles.userId))
    .where(eq(users.id, userId))
    .limit(1);

  if (identity === undefined) {
    return null;
  }

  const capabilities = await database
    .select({
      capability: userCapabilities.capability,
      isActive: userCapabilities.isActive,
    })
    .from(userCapabilities)
    .where(eq(userCapabilities.userId, userId));

  return buildAccessPrincipal({
    capabilities,
    staffProfile:
      identity.staffRole === null || identity.staffActive === null
        ? null
        : { isActive: identity.staffActive, role: identity.staffRole },
    userActive: identity.userActive,
    userId: identity.userId,
  });
}
