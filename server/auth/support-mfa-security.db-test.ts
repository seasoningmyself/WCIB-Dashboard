import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { test } from "node:test";
import { createDatabasePool } from "../db/client.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  auditEvents,
  mfaChallenges,
  mfaRecoveryGrants,
  mfaStepUpAuthorizations,
  userCapabilities,
  userMfaMethods,
  userMfaRecoveryCodes,
  userMfaSettings,
  users,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import type { AccessPrincipal } from "./access.js";
import type { AuthorizedRequestContext } from "./authorization.js";
import {
  LastMfaMethodError,
  MfaPolicyRequiredError,
  disableOwnMfa,
  removeOwnMfaMethod,
} from "./mfa-management.js";
import {
  MfaResetAccessDeniedError,
  MfaResetConflictError,
  resetUserMfa,
} from "./mfa-reset.js";
import { loadMfaAccessState } from "./mfa-state.js";
import { hashPassword } from "./password.js";
import { issueStepUpAuthorization } from "./mfa-step-up.js";
import { createUser } from "./users.js";

const PASSWORD = "Support test password 2026!";
const logger: AppLogger = { error() {}, info() {}, warn() {} };

test("support MFA is mandatory and reset is scoped, atomic, and audited", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for support MFA tests");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_support_mfa",
    async (isolatedUrl) => {
      const pool = createDatabasePool(isolatedUrl);
      const database = drizzle(pool, { schema: databaseSchema });
      try {
      const suffix = randomUUID();
      const support = await createUser(database, {
        displayName: `Support ${suffix}`,
        email: `support-${suffix}@example.test`,
        password: PASSWORD,
      });
      const target = await createUser(database, {
        displayName: `Target ${suffix}`,
        email: `target-${suffix}@example.test`,
        password: PASSWORD,
      });
      const employee = await createUser(database, {
        displayName: `Employee ${suffix}`,
        email: `employee-${suffix}@example.test`,
        password: PASSWORD,
      });
      await database.insert(userCapabilities).values({
        capability: "support_engineer",
        userId: support.id,
      });

      const supportContext = context(support.id, ["support_engineer"]);
      const employeeContext = context(employee.id, []);
      const unenrolled = await loadMfaAccessState(database, support.id, {
        adminEnforcementEnabled: false,
        allUsersEnforcementEnabled: false,
        isAdmin: false,
        isSupportEngineer: true,
      });
      assert.equal(unenrolled.policyRequired, true);
      assert.equal(unenrolled.enrolled, false);
      await assert.rejects(
        disableOwnMfa(
          database,
          supportContext,
          proof(support.id, "mfa_disable", { enabled: false }, "unused"),
          {
            adminEnforcementEnabled: false,
            allUsersEnforcementEnabled: false,
            isAdmin: false,
            isSupportEngineer: true,
          },
          logger,
        ),
        MfaPolicyRequiredError,
      );

      const enrolledAt = new Date("2026-07-22T12:00:00.000Z");
      await database.insert(userMfaSettings).values([
        {
          enforcementEnabled: true,
          enrollmentCompletedAt: enrolledAt,
          recoveryCodesAcknowledgedAt: enrolledAt,
          userId: support.id,
        },
        {
          enforcementEnabled: true,
          enrollmentCompletedAt: enrolledAt,
          recoveryCodesAcknowledgedAt: enrolledAt,
          userId: target.id,
        },
      ]);
      const [supportMethod, targetMethod] = await database
        .insert(userMfaMethods)
        .values([
          {
            isPrimary: true,
            label: "Support authenticator",
            methodType: "totp",
            userId: support.id,
            verifiedAt: enrolledAt,
          },
          {
            isPrimary: true,
            label: "Target passkey",
            methodType: "webauthn",
            userId: target.id,
            verifiedAt: enrolledAt,
          },
        ])
        .returning({ id: userMfaMethods.id, userId: userMfaMethods.userId });
      assert.ok(supportMethod && targetMethod);

      const removeDescriptor = {
        action: "mfa_disable" as const,
        mutation: { methodId: supportMethod.id },
        targetUserId: support.id,
      };
      const removeGrant = await issueStepUpAuthorization(
        database,
        supportContext,
        removeDescriptor,
        { sessionId: "support-remove-session", sessionVersion: 0 },
        "totp",
        logger,
      );
      await assert.rejects(
        removeOwnMfaMethod(
          database,
          supportContext,
          supportMethod.id,
          {
            sessionId: "support-remove-session",
            sessionVersion: 0,
            token: removeGrant.token,
          },
          logger,
        ),
        LastMfaMethodError,
      );

      await database.insert(userMfaRecoveryCodes).values({
        codeHash: await hashPassword("support recovery fixture"),
        lookupPrefix: "ABCDEF1234",
        userId: target.id,
      });
      await database.insert(mfaChallenges).values({
        challengeHash: "a".repeat(64),
        expiresAt: new Date("2026-07-23T12:00:00.000Z"),
        purpose: "webauthn_authentication",
        userId: target.id,
      });
      await database.insert(mfaRecoveryGrants).values({
        expiresAt: new Date("2026-07-23T12:00:00.000Z"),
        sessionIdHash: "b".repeat(64),
        userId: target.id,
      });
      await database.insert(mfaStepUpAuthorizations).values({
        actionType: "mfa_reset",
        expiresAt: new Date("2026-07-23T12:00:00.000Z"),
        methodType: "totp",
        mutationDigest: "c".repeat(64),
        sessionIdHash: "d".repeat(64),
        sessionVersion: 0,
        targetUserId: support.id,
        tokenHash: "e".repeat(64),
        userId: target.id,
      });

      const resetInput = { reason: "Lost security device during support call" };
      const resetDescriptor = {
        action: "mfa_reset" as const,
        mutation: resetInput,
        targetUserId: target.id,
      };
      const resetGrant = await issueStepUpAuthorization(
        database,
        supportContext,
        resetDescriptor,
        { sessionId: "support-reset-session", sessionVersion: 0 },
        "totp",
        logger,
      );
      await resetUserMfa(
        database,
        supportContext,
        target.id,
        resetInput,
        {
          descriptor: resetDescriptor,
          sessionId: "support-reset-session",
          sessionVersion: 0,
          token: resetGrant.token,
        },
        logger,
        new Date("2026-07-22T13:00:00.000Z"),
      );

      const [targetAfter] = await database
        .select({ sessionVersion: users.sessionVersion })
        .from(users)
        .where(eq(users.id, target.id));
      const [methodAfter] = await database
        .select({ disabledAt: userMfaMethods.disabledAt })
        .from(userMfaMethods)
        .where(eq(userMfaMethods.id, targetMethod.id));
      const [settingsAfter] = await database
        .select({
          enrollmentCompletedAt: userMfaSettings.enrollmentCompletedAt,
          enforcementEnabled: userMfaSettings.enforcementEnabled,
          policyRequiredAt: userMfaSettings.policyRequiredAt,
        })
        .from(userMfaSettings)
        .where(eq(userMfaSettings.userId, target.id));
      assert.equal(targetAfter?.sessionVersion, 1);
      assert.equal(methodAfter?.disabledAt?.toISOString(), "2026-07-22T13:00:00.000Z");
      assert.equal(settingsAfter?.enforcementEnabled, true);
      assert.equal(settingsAfter?.enrollmentCompletedAt, null);
      assert.equal(settingsAfter?.policyRequiredAt?.toISOString(), "2026-07-22T13:00:00.000Z");
      for (const table of [
        userMfaRecoveryCodes,
        mfaChallenges,
        mfaRecoveryGrants,
        mfaStepUpAuthorizations,
      ]) {
        const rows = await database
          .select()
          .from(table)
          .where(eq(table.userId, target.id));
        assert.equal(rows.length, 0);
      }

      const resetAudits = await database
        .select({
          actorUserId: auditEvents.actorUserId,
          afterSummary: auditEvents.afterSummary,
          entityId: auditEvents.entityId,
        })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.action, "user_mfa_reset"),
            eq(auditEvents.entityId, target.id),
          ),
        );
      assert.deepEqual(resetAudits, [
        {
          actorUserId: support.id,
          afterSummary: {
            method: "totp",
            outcome: "success",
            reason: resetInput.reason,
          },
          entityId: target.id,
        },
      ]);

      await assert.rejects(
        resetUserMfa(
          database,
          supportContext,
          support.id,
          resetInput,
          proof(support.id, "mfa_reset", resetInput, "unused"),
          logger,
        ),
        MfaResetConflictError,
      );
      await assert.rejects(
        resetUserMfa(
          database,
          employeeContext,
          target.id,
          resetInput,
          proof(target.id, "mfa_reset", resetInput, "unused"),
          logger,
        ),
        MfaResetAccessDeniedError,
      );
      } finally {
        await pool.end();
      }
    },
  );
});

function context(
  userId: string,
  capabilities: AccessPrincipal["capabilities"],
): AuthorizedRequestContext {
  return {
    authentication: { state: "authenticated" },
    principal: {
      capabilities,
      staffRole: null,
      userActive: true,
      userId,
    },
  };
}

function proof(
  targetUserId: string,
  action: "mfa_disable" | "mfa_reset",
  mutation: Record<string, unknown>,
  token: string,
) {
  return {
    descriptor: { action, mutation, targetUserId },
    sessionId: "unused-session",
    sessionVersion: 0,
    token,
  };
}
