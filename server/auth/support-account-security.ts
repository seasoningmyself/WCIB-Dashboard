import { and, eq, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  supportAccountSecurityListResponseSchema,
  type SupportAccountSecurityItem,
  type SupportAccountSecurityListResponse,
} from "../../shared/support-account-security.js";
import { evaluateAccess, type AccessRequirement } from "./access.js";
import type { AuthorizedRequestContext } from "./authorization.js";
import { loadMfaState } from "./mfa-state.js";
import type { AuthDatabase } from "./users.js";
import { userCapabilities, users } from "../db/schema.js";
import { writeAuditEventInDrizzleTransaction } from "../audit/event.js";
import type { AppLogger } from "../logging/logger.js";

export const SUPPORT_ACCOUNT_SECURITY_ACCESS = {
  capabilities: ["support_engineer"],
} as const satisfies AccessRequirement;

const adminCapabilities = alias(userCapabilities, "support_target_admin");
const supportCapabilities = alias(userCapabilities, "support_target_support");

export class SupportAccountSecurityAccessDeniedError extends Error {
  constructor() {
    super("Support account security access is denied");
    this.name = "SupportAccountSecurityAccessDeniedError";
  }
}

export async function listSupportAccountSecurityTargets(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  adminEnforcementEnabled: boolean,
  allUsersEnforcementEnabled: boolean,
  logger: AppLogger,
): Promise<SupportAccountSecurityItem[]> {
  requireSupportAccess(context);
  const accounts = await database
    .select({
      adminCapability: adminCapabilities.isActive,
      displayName: users.displayName,
      email: users.email,
      id: users.id,
      supportCapability: supportCapabilities.isActive,
    })
    .from(users)
    .leftJoin(
      adminCapabilities,
      and(
        eq(adminCapabilities.userId, users.id),
        eq(adminCapabilities.capability, "admin"),
      ),
    )
    .leftJoin(
      supportCapabilities,
      and(
        eq(supportCapabilities.userId, users.id),
        eq(supportCapabilities.capability, "support_engineer"),
      ),
    )
    .where(ne(users.id, context.principal.userId))
    .orderBy(users.displayName, users.id);

  const result: SupportAccountSecurityItem[] = [];
  for (const account of accounts) {
    const mfa = await loadMfaState(database, account.id, {
      adminEnforcementEnabled,
      allUsersEnforcementEnabled,
      isAdmin: account.adminCapability === true,
      isSupportEngineer: account.supportCapability === true,
    });
    result.push({
      displayName: account.displayName,
      email: account.email,
      id: account.id,
      mfaEnrolled: mfa.enrolled,
      mfaEnrollmentRequired: mfa.enrollmentRequired,
    });
  }
  await database.transaction(async (transaction) => {
    await writeAuditEventInDrizzleTransaction(
      transaction,
      context,
      {
        action: "support_surface_viewed",
        after: {
          allowedFields: ["outcome"],
          source: { outcome: "success" },
        },
        entityId: context.principal.userId,
        entityType: "user",
      },
      logger,
    );
  });
  return result;
}

export function projectSupportAccountSecurityTargets(
  source: Readonly<SupportAccountSecurityListResponse>,
  context: AuthorizedRequestContext,
): SupportAccountSecurityListResponse | null {
  if (!evaluateAccess(context.principal, SUPPORT_ACCOUNT_SECURITY_ACCESS).allowed) {
    return null;
  }
  return supportAccountSecurityListResponseSchema.parse(source);
}

function requireSupportAccess(context: AuthorizedRequestContext): void {
  if (!evaluateAccess(context.principal, SUPPORT_ACCOUNT_SECURITY_ACCESS).allowed) {
    throw new SupportAccountSecurityAccessDeniedError();
  }
}
