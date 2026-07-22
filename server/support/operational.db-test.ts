import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { hashPassword } from "../auth/password.js";
import { createUser, type AuthDatabase } from "../auth/users.js";
import type { SupportConfig } from "../config/support.js";
import { createDatabasePool } from "../db/client.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  auditEvents,
  kpiTargets,
  loginThrottleBuckets,
  userCapabilities,
  userMfaMethods,
  userMfaRecoveryCodes,
  userMfaSettings,
  users,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import { createDigitalOceanBackupProvider } from "./digitalocean-backups.js";
import {
  loadOperationalSupportDashboard,
  SupportDashboardAccessDeniedError,
} from "./operational.js";
import { createSentrySupportProvider } from "./sentry.js";

const PASSWORD = "StrongPass123!";
const NOW = new Date("2026-07-22T18:00:00.000Z");
const logger: AppLogger = { error() {}, info() {}, warn() {} };
const config: SupportConfig = {
  backupFreshnessThresholdHours: 30,
  digitalOceanBackup: null,
  release: {
    deployedAt: "2026-07-22T17:00:00.000Z",
    sha: "a".repeat(40),
  },
  sentry: null,
};

test("support dashboard exposes bounded diagnostics and audits access", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for support dashboard test");
  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_s162_support",
    async (isolatedUrl) => {
      const pool = createDatabasePool(isolatedUrl);
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const support = await createUser(database, {
          displayName: `STONE 162 Support ${randomUUID()}`,
          email: `stone162-support-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        const sophia = await createUser(database, {
          displayName: `STONE 162 Sophia ${randomUUID()}`,
          email: `stone162-sophia-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        const earl = await createUser(database, {
          displayName: `STONE 162 Earl ${randomUUID()}`,
          email: `stone162-earl-${randomUUID()}@example.test`,
          password: PASSWORD,
        });
        await database.insert(userCapabilities).values([
          { capability: "support_engineer", userId: support.id },
          { capability: "admin", userId: sophia.id },
          { capability: "admin", userId: earl.id },
        ]);
        await enrollMfa(database, support.id, "SUPPORT001");
        await enrollMfa(database, sophia.id, "SOPHIA0001");
        await database
          .update(users)
          .set({ lastLoginAt: NOW })
          .where(eq(users.id, sophia.id));
        await database.insert(loginThrottleBuckets).values([
          {
            blockedUntil: new Date(NOW.getTime() + 60_000),
            bucketHash: "1".repeat(64),
            failureCount: 5,
            kind: "account",
            lastFailedAt: new Date(NOW.getTime() - 60_000),
          },
          {
            blockedUntil: null,
            bucketHash: "2".repeat(64),
            failureCount: 2,
            kind: "ip",
            lastFailedAt: new Date(NOW.getTime() - 120_000),
          },
        ]);
        await database.insert(kpiTargets).values({
          newPolicyCountTarget: 12,
          newRevenueTarget: "1200.00",
          producerUserId: null,
          retentionRateTarget: "80.00",
          scopeType: "company",
          year: 2026,
        });
        await database.insert(auditEvents).values([
          {
            action: "user_password_changed",
            actorUserId: sophia.id,
            entityId: sophia.id,
            entityType: "user",
            occurredAt: new Date(NOW.getTime() - 120_000),
          },
          {
            action: "pay_sheet_closed",
            actorUserId: sophia.id,
            entityId: randomUUID(),
            entityType: "pay_sheet",
            occurredAt: new Date(NOW.getTime() - 60_000),
          },
        ]);

        const dashboard = await loadOperationalSupportDashboard(
          database,
          context(support.id, ["support_engineer"]),
          {
            backupProvider: createDigitalOceanBackupProvider(null, 30),
            config,
            logger,
            nodeEnv: "production",
            now: () => NOW,
            readinessCheck: async () => {},
            telemetryProvider: createSentrySupportProvider(null),
            timer: (() => {
              let value = 10;
              return () => value++;
            })(),
          },
        );

        assert.equal(dashboard.release.status, "available");
        assert.equal(dashboard.readiness.status, "ready");
        assert.equal(dashboard.migration.status, "in_sync");
        assert.equal(dashboard.backup.status, "unavailable");
        assert.equal(dashboard.sentry.status, "unavailable");
        assert.equal(dashboard.integrity.status, "ok");
        assert.deepEqual(dashboard.companyNumbers.targets, {
          newPolicyCount: 12,
          newRevenue: "1200.00",
          retentionRate: "80.00",
        });
        assert.equal(dashboard.companyNumbers.empty, true);
        assert.equal(dashboard.auditActivity.totalEventCount, 2);
        assert.equal(
          dashboard.auditActivity.categories.find(
            ({ type }) => type === "authentication",
          )?.count,
          1,
        );
        assert.equal(
          dashboard.auditActivity.categories.find(
            ({ type }) => type === "financial_workflow",
          )?.count,
          1,
        );
        assert.equal(dashboard.administrators.length, 2);
        const sophiaState = dashboard.administrators.find(
          ({ email }) => email === sophia.email,
        );
        const earlState = dashboard.administrators.find(
          ({ email }) => email === earl.email,
        );
        assert.deepEqual(
          { lastLoginAt: sophiaState?.lastLoginAt, mfa: sophiaState?.mfaEnrolled },
          { lastLoginAt: NOW.toISOString(), mfa: true },
        );
        assert.deepEqual(
          { lastLoginAt: earlState?.lastLoginAt, mfa: earlState?.mfaEnrolled },
          { lastLoginAt: null, mfa: false },
        );
        assert.equal(dashboard.loginSecurity.accountFailureBucketCount, 1);
        assert.equal(dashboard.loginSecurity.activeAccountThrottleCount, 1);
        assert.deepEqual(
          dashboard.loginSecurity.patterns.map(({ kind }) => kind),
          ["account_repeated_failures", "active_cooldowns"],
        );

        const [audit] = await database
          .select({
            action: auditEvents.action,
            actorUserId: auditEvents.actorUserId,
            afterSummary: auditEvents.afterSummary,
            entityId: auditEvents.entityId,
          })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.action, "support_surface_viewed"),
              eq(auditEvents.actorUserId, support.id),
            ),
          );
        assert.deepEqual(audit, {
          action: "support_surface_viewed",
          actorUserId: support.id,
          afterSummary: { outcome: "success" },
          entityId: support.id,
        });

        const serialized = JSON.stringify(dashboard);
        for (const forbidden of [
          "bucketHash",
          "commission",
          "passwordHash",
          "paySheet",
          "policyNumber",
          "recoveryCodes",
          "sessionVersion",
          "stackTrace",
        ]) {
          assert.equal(serialized.includes(forbidden), false, forbidden);
        }

        await assert.rejects(
          () =>
            loadOperationalSupportDashboard(
              database,
              context(sophia.id, ["admin"]),
              {
                backupProvider: createDigitalOceanBackupProvider(null, 30),
                config,
                logger,
                nodeEnv: "production",
                telemetryProvider: createSentrySupportProvider(null),
              },
            ),
          SupportDashboardAccessDeniedError,
        );
      } finally {
        await pool.end();
      }
    },
  );
});

async function enrollMfa(
  database: AuthDatabase,
  userId: string,
  lookupPrefix: string,
): Promise<void> {
  await database.insert(userMfaSettings).values({
    enrollmentCompletedAt: NOW,
    enforcementEnabled: true,
    recoveryCodesAcknowledgedAt: NOW,
    userId,
  });
  await database.insert(userMfaMethods).values({
    isPrimary: true,
    label: "Security key",
    methodType: "webauthn",
    userId,
    verifiedAt: NOW,
  });
  await database.insert(userMfaRecoveryCodes).values({
    codeHash: await hashPassword(`recovery ${lookupPrefix}`),
    lookupPrefix,
    userId,
  });
}

function context(
  userId: string,
  capabilities: readonly ("admin" | "support_engineer")[],
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
