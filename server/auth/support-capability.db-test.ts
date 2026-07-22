import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { test } from "node:test";
import {
  AdminAccountSecurityConflictError,
  listAdminAccountSecurity,
  setSupportCapability,
} from "./admin-account-security.js";
import type { AuthorizedRequestContext } from "./authorization.js";
import { issueStepUpAuthorization } from "./mfa-step-up.js";
import { createUser } from "./users.js";
import { listSupportAccountSecurityTargets } from "./support-account-security.js";
import { createDatabasePool } from "../db/client.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  auditEvents,
  staffProfiles,
  userCapabilities,
  userMfaSettings,
  users,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";

const PASSWORD = "Support capability fixture 2026!";
const logger: AppLogger = { error() {}, info() {}, warn() {} };

test("admin grants support only to capability-only accounts with mandatory MFA", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for support capability tests");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_support_cap",
    async (isolatedUrl) => {
      const pool = createDatabasePool(isolatedUrl);
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const suffix = randomUUID();
        const administrator = await createUser(database, {
          displayName: `Administrator ${suffix}`,
          email: `administrator-${suffix}@example.test`,
          password: PASSWORD,
        });
        const support = await createUser(database, {
          displayName: `Support ${suffix}`,
          email: `support-${suffix}@example.test`,
          password: PASSWORD,
        });
        const staff = await createUser(database, {
          displayName: `Staff ${suffix}`,
          email: `staff-${suffix}@example.test`,
          password: PASSWORD,
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: administrator.id,
        });
        await database.insert(staffProfiles).values({
          role: "employee",
          userId: staff.id,
        });
        const context = adminContext(administrator.id);
        const enabledAt = new Date("2026-07-22T14:00:00.000Z");
        const enabled = { enabled: true };
        const enabledProof = await supportProof(
          database,
          context,
          support.id,
          enabled,
          "grant-support-session",
        );

        await setSupportCapability(
          database,
          context,
          support.id,
          enabled,
          enabledProof,
          false,
          false,
          logger,
          enabledAt,
        );

        const [capability] = await database
          .select({ isActive: userCapabilities.isActive })
          .from(userCapabilities)
          .where(
            and(
              eq(userCapabilities.userId, support.id),
              eq(userCapabilities.capability, "support_engineer"),
            ),
          );
        const [settings] = await database
          .select({
            enforcementEnabled: userMfaSettings.enforcementEnabled,
            policyRequiredAt: userMfaSettings.policyRequiredAt,
          })
          .from(userMfaSettings)
          .where(eq(userMfaSettings.userId, support.id));
        const [account] = await database
          .select({ sessionVersion: users.sessionVersion })
          .from(users)
          .where(eq(users.id, support.id));
        assert.equal(capability?.isActive, true);
        assert.equal(settings?.enforcementEnabled, true);
        assert.equal(settings?.policyRequiredAt?.toISOString(), enabledAt.toISOString());
        assert.equal(account?.sessionVersion, 1);
        const accountSecurity = await listAdminAccountSecurity(
          database,
          context,
          false,
          false,
        );
        const supportAccount = accountSecurity.find(({ id }) => id === support.id);
        assert.equal(supportAccount?.adminCapability, false);
        assert.equal(supportAccount?.staffRole, null);
        assert.equal(supportAccount?.supportCapability, true);

        const targets = await listSupportAccountSecurityTargets(
          database,
          supportContext(support.id),
          false,
          false,
          logger,
        );
        assert.equal(targets.some(({ id }) => id === support.id), false);
        assert.equal(targets.some(({ id }) => id === administrator.id), true);
        assert.equal(targets.some(({ id }) => id === staff.id), true);
        for (const target of targets) {
          assert.deepEqual(Object.keys(target).sort(), [
            "displayName",
            "email",
            "id",
            "mfaEnrolled",
            "mfaEnrollmentRequired",
          ]);
        }

        const staffProof = await supportProof(
          database,
          context,
          staff.id,
          enabled,
          "staff-support-session",
        );
        await assert.rejects(
          setSupportCapability(
            database,
            context,
            staff.id,
            enabled,
            staffProof,
            false,
            false,
            logger,
          ),
          AdminAccountSecurityConflictError,
        );

        const audits = await database
          .select({
            actorUserId: auditEvents.actorUserId,
            afterSummary: auditEvents.afterSummary,
            entityId: auditEvents.entityId,
          })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.action, "user_support_capability_changed"),
              eq(auditEvents.entityId, support.id),
            ),
          );
        assert.deepEqual(audits, [{
          actorUserId: administrator.id,
          afterSummary: { actionType: "enabled" },
          entityId: support.id,
        }]);
        const supportViews = await database
          .select({ afterSummary: auditEvents.afterSummary })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.action, "support_surface_viewed"),
              eq(auditEvents.actorUserId, support.id),
            ),
          );
        assert.deepEqual(supportViews, [{ afterSummary: { outcome: "success" } }]);
      } finally {
        await pool.end();
      }
    },
  );
});

function adminContext(userId: string): AuthorizedRequestContext {
  return {
    authentication: { state: "authenticated" },
    principal: {
      capabilities: ["admin"],
      staffRole: null,
      userActive: true,
      userId,
    },
  };
}

function supportContext(userId: string): AuthorizedRequestContext {
  return {
    authentication: { state: "authenticated" },
    principal: {
      capabilities: ["support_engineer"],
      staffRole: null,
      userActive: true,
      userId,
    },
  };
}

async function supportProof(
  database: Parameters<typeof issueStepUpAuthorization>[0],
  context: AuthorizedRequestContext,
  targetUserId: string,
  mutation: { enabled: boolean },
  sessionId: string,
) {
  const descriptor = {
    action: "admin_capability_change" as const,
    mutation: { capability: "support_engineer", ...mutation },
    targetUserId,
  };
  const grant = await issueStepUpAuthorization(
    database,
    context,
    descriptor,
    { sessionId, sessionVersion: 0 },
    "totp",
    logger,
  );
  return {
    descriptor,
    sessionId,
    sessionVersion: 0,
    token: grant.token,
  };
}
