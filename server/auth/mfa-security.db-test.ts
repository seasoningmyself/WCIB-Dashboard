import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { generateSync } from "otplib";
import {
  resetAdminMfa,
  setAdminCapability,
  updateAdminAccountEmail,
} from "./admin-account-security.js";
import {
  issueAdminTemporaryPassword,
  updateAdminStaff,
} from "./admin-staff.js";
import type { AuthorizedRequestContext } from "./authorization.js";
import {
  acknowledgeRecoveryCodes,
} from "./mfa-enrollment.js";
import {
  disableOwnMfa,
  LastMfaMethodError,
  MfaMethodNotFoundError,
  MfaPolicyRequiredError,
  removeOwnMfaMethod,
  renameOwnMfaMethod,
} from "./mfa-management.js";
import {
  consumeRecoveryCode,
  replaceRecoveryCodesInTransaction,
  validateRecoveryGrant,
} from "./mfa-recovery.js";
import {
  ensureMfaSettings,
  loadMfaAccessState,
  loadMfaState,
} from "./mfa-state.js";
import {
  consumeStepUpAuthorization,
  issueStepUpAuthorization,
  StepUpRequiredError,
  type StepUpProof,
} from "./mfa-step-up.js";
import {
  confirmTotpEnrollment,
  startTotpEnrollment,
  verifyTotpForUser,
} from "./mfa-totp.js";
import {
  startWebAuthnAuthentication,
  startWebAuthnRegistration,
} from "./mfa-webauthn.js";
import { verifyPassword } from "./password.js";
import { createUser, type AuthDatabase } from "./users.js";
import { createDatabasePool } from "../db/client.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import {
  auditEvents,
  mfaStepUpAuthorizations,
  sessions,
  staffProfiles,
  userCapabilities,
  userMfaMethods,
  userMfaRecoveryCodes,
  userMfaSettings,
  userTotpCredentials,
  userWebAuthnCredentials,
  userWebAuthnCredentialTransports,
  users,
} from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";

const PASSWORD = "Mfa security fixture 72!";
const TEMPORARY_PASSWORD = "Copper Harbor Ledger 72!";
const TEST_KEY = Object.freeze({
  id: "mfa-db-test",
  key: Buffer.alloc(32, 0x53),
});
const KEY_RING = Object.freeze({
  all: Object.freeze([TEST_KEY]),
  current: TEST_KEY,
});
const WEB_AUTHN = Object.freeze({
  origin: "http://localhost:5173",
  rpId: "localhost",
  rpName: "WCIB MFA test",
});
const logger: AppLogger = {
  error() {},
  info() {},
  warn() {},
};

test("MFA factors, recovery, policy, and step-up guarantees hold", async (t) => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for MFA security tests");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_mfa_security",
    async (isolatedUrl) => {
      const pool = createDatabasePool(isolatedUrl);
      const database = drizzle(pool, { schema: databaseSchema });
      try {
        const runId = randomUUID();
        const actor = await createUser(database, {
          displayName: "MFA Admin",
          email: `mfa-admin.${runId}@example.test`,
          password: PASSWORD,
        });
        const staffTarget = await createUser(database, {
          displayName: "MFA Staff Target",
          email: `mfa-staff.${runId}@example.test`,
          password: PASSWORD,
        });
        const policyTarget = await createUser(database, {
          displayName: "MFA Policy Target",
          email: `mfa-policy.${runId}@example.test`,
          password: PASSWORD,
        });
        const recoveryUser = await createUser(database, {
          displayName: "MFA Recovery User",
          email: `mfa-recovery.${runId}@example.test`,
          password: PASSWORD,
        });
        const resetTarget = await createUser(database, {
          displayName: "MFA Reset Target",
          email: `mfa-reset.${runId}@example.test`,
          password: PASSWORD,
        });
        const methodUser = await createUser(database, {
          displayName: "MFA Method User",
          email: `mfa-method.${runId}@example.test`,
          password: PASSWORD,
        });
        const webAuthnOptionsUser = await createUser(database, {
          displayName: "WebAuthn Options User",
          email: `mfa-webauthn.${runId}@example.test`,
          password: PASSWORD,
        });
        await database.insert(userCapabilities).values({
          capability: "admin",
          userId: actor.id,
        });
        await database.insert(staffProfiles).values([
          { role: "employee", userId: staffTarget.id },
          { role: "employee", userId: policyTarget.id },
          { role: "employee", userId: recoveryUser.id },
          { role: "employee", userId: resetTarget.id },
          { role: "employee", userId: methodUser.id },
          { role: "employee", userId: webAuthnOptionsUser.id },
        ]);
        const context = adminContext(actor.id);

        await t.test("the all-account policy requires employee enrollment", async () => {
          const access = await loadMfaAccessState(database, staffTarget.id, {
            adminEnforcementEnabled: false,
            allUsersEnforcementEnabled: true,
            isAdmin: false,
          });
          assert.equal(access.enrolled, false);
          assert.equal(access.policyRequired, true);

          const state = await loadMfaState(database, staffTarget.id, {
            adminEnforcementEnabled: false,
            allUsersEnforcementEnabled: true,
            isAdmin: false,
          });
          assert.equal(state.enrollmentRequired, true);
          assert.equal(state.policyRequired, true);

          await assert.rejects(
            disableOwnMfa(
              database,
              employeeContext(staffTarget.id),
              missingProof(staffTarget.id, "mfa_disable", { enabled: false }),
              {
                adminEnforcementEnabled: false,
                allUsersEnforcementEnabled: true,
                isAdmin: false,
              },
              logger,
            ),
            MfaPolicyRequiredError,
          );
        });

        await t.test("TOTP enrollment hashes recovery codes and rejects replay", async () => {
          const now = new Date("2026-07-21T18:00:00.000Z");
          const started = await startTotpEnrollment(
            database,
            actor,
            "MFA test authenticator",
            KEY_RING,
            now,
          );
          await insertSession(database, "actor-before-enrollment", actor.id, 0);
          const code = totpCode(started.secret, now);
          const enrolled = await confirmTotpEnrollment(
            database,
            context,
            started.methodId,
            code,
            KEY_RING,
            logger,
            now,
          );
          assert.equal(enrolled.user.sessionVersion, 1);
          assert.equal(enrolled.requiresRecoveryAcknowledgement, true);
          assert.equal(enrolled.recoveryCodes.length, 10);
          assert.equal(new Set(enrolled.recoveryCodes).size, 10);
          assert.equal(await sessionCount(database), 0);

          const [secretRecord] = await database
            .select({ encryptedSecret: userTotpCredentials.encryptedSecret })
            .from(userTotpCredentials)
            .where(eq(userTotpCredentials.methodId, started.methodId));
          assert.ok(secretRecord);
          assert.match(secretRecord.encryptedSecret, /^wcibenc:v1:/);
          assert.equal(secretRecord.encryptedSecret.includes(started.secret), false);

          const storedCodes = await database
            .select({ codeHash: userMfaRecoveryCodes.codeHash })
            .from(userMfaRecoveryCodes)
            .where(eq(userMfaRecoveryCodes.userId, actor.id));
          assert.equal(storedCodes.length, 10);
          assert.ok(storedCodes.every(({ codeHash }) => codeHash.startsWith("$argon2id$")));
          assert.equal(
            JSON.stringify(storedCodes).includes(enrolled.recoveryCodes[0] ?? "missing"),
            false,
          );

          await insertSession(database, "actor-before-ack", actor.id, 1);
          const acknowledged = await acknowledgeRecoveryCodes(
            database,
            context,
            undefined,
            logger,
            new Date(now.getTime() + 1_000),
          );
          assert.equal(acknowledged.sessionVersion, 2);
          assert.equal(await sessionCount(database), 0);

          assert.equal(
            await verifyTotpForUser(database, actor.id, code, KEY_RING, now),
            null,
          );
          const nextTime = new Date(now.getTime() + 30_000);
          const nextCode = totpCode(started.secret, nextTime);
          assert.equal(
            await verifyTotpForUser(
              database,
              actor.id,
              nextCode,
              KEY_RING,
              nextTime,
            ),
            started.methodId,
          );
          assert.equal(
            await verifyTotpForUser(
              database,
              actor.id,
              nextCode,
              KEY_RING,
              nextTime,
            ),
            null,
          );
        });

        await t.test("recovery codes are one-use and grant only re-enrollment", async () => {
          await ensureMfaSettings(database, recoveryUser.id);
          await database.insert(userMfaMethods).values({
            isPrimary: true,
            label: "Recovery fixture passkey",
            methodType: "webauthn",
            userId: recoveryUser.id,
            verifiedAt: new Date(),
          });
          await database
            .update(userMfaSettings)
            .set({
              enforcementEnabled: true,
              enrollmentCompletedAt: new Date(),
              recoveryCodesAcknowledgedAt: new Date(),
            })
            .where(eq(userMfaSettings.userId, recoveryUser.id));
          const recovery = await database.transaction((transaction) =>
            replaceRecoveryCodesInTransaction(
              transaction as AuthDatabase,
              recoveryUser.id,
            ),
          );
          const code = recovery.codes[0];
          assert.ok(code);
          const recovered = await consumeRecoveryCode(
            database,
            employeeContext(recoveryUser.id),
            code,
            "recovery-session",
            logger,
          );
          assert.ok(recovered);
          assert.equal(recovered.recoveryCodesRemaining, 9);
          assert.equal(
            await consumeRecoveryCode(
              database,
              employeeContext(recoveryUser.id),
              code,
              "recovery-session-2",
              logger,
            ),
            null,
          );
          assert.equal(
            await validateRecoveryGrant(
              database,
              recoveryUser.id,
              recovered.grantId,
              "recovery-session",
            ),
            true,
          );
          assert.equal(
            await validateRecoveryGrant(
              database,
              recoveryUser.id,
              recovered.grantId,
              "different-session",
            ),
            false,
          );
          assert.deepEqual(
            await loadMfaAccessState(database, recoveryUser.id, {
              adminEnforcementEnabled: false,
              isAdmin: false,
            }),
            {
              activeMethodCount: 0,
              enrolled: false,
              enrollmentIncomplete: true,
              enforcementEnabled: true,
              policyRequired: false,
              recoveryCodesAcknowledged: false,
              requiresMfaLogin: true,
            },
          );
          const recoveryAudit = await database
            .select({ action: auditEvents.action })
            .from(auditEvents)
            .where(eq(auditEvents.actorUserId, recoveryUser.id));
          assert.deepEqual(
            recoveryAudit.map(({ action }) => action).sort(),
            ["user_mfa_method_removed", "user_mfa_recovery_code_used"],
          );
          await assert.rejects(
            consumeStepUpAuthorization(
              database,
              employeeContext(recoveryUser.id),
              {
                descriptor: {
                  action: "mfa_disable",
                  mutation: { enabled: false },
                  targetUserId: recoveryUser.id,
                },
                sessionId: "recovery-session",
                sessionVersion: recovered.user.sessionVersion,
                token: code,
              },
            ),
            StepUpRequiredError,
          );
        });

        await t.test("WebAuthn requests tap-only NFC security keys without PIN enrollment", async () => {
          const now = new Date("2026-07-21T18:02:00.000Z");
          const registration = await startWebAuthnRegistration(
            database,
            webAuthnOptionsUser,
            WEB_AUTHN,
            now,
          );
          assert.equal(
            registration.options.authenticatorSelection?.userVerification,
            "discouraged",
          );
          assert.equal(
            registration.options.authenticatorSelection?.residentKey,
            "discouraged",
          );
          assert.equal(
            registration.options.authenticatorSelection?.authenticatorAttachment,
            undefined,
          );

          const [method] = await database
            .insert(userMfaMethods)
            .values({
              isPrimary: true,
              label: "NFC YubiKey",
              methodType: "webauthn",
              userId: webAuthnOptionsUser.id,
              verifiedAt: now,
            })
            .returning({ id: userMfaMethods.id });
          assert.ok(method);
          await database.insert(userWebAuthnCredentials).values({
            counter: 0,
            credentialId: "nfc-security-key-fixture",
            methodId: method.id,
            publicKey: "fixture-public-key",
          });
          await database.insert(userWebAuthnCredentialTransports).values([
            { methodId: method.id, transport: "nfc" },
            { methodId: method.id, transport: "usb" },
          ]);
          const authentication = await startWebAuthnAuthentication(
            database,
            webAuthnOptionsUser.id,
            "webauthn_authentication",
            WEB_AUTHN,
            null,
            now,
          );
          assert.ok(authentication);
          assert.equal(authentication.options.userVerification, "discouraged");
          assert.deepEqual(
            authentication.options.allowCredentials?.[0]?.transports,
            ["nfc", "usb"],
          );
        });

        await t.test("method nicknames and individual removal preserve factor history", async () => {
          const now = new Date("2026-07-21T18:03:00.000Z");
          const methodContext = employeeContext(methodUser.id);
          await ensureMfaSettings(database, methodUser.id);
          const methods = await database
            .insert(userMfaMethods)
            .values([
              {
                isPrimary: true,
                label: "Original security key",
                methodType: "webauthn" as const,
                userId: methodUser.id,
                verifiedAt: now,
              },
              {
                label: "Backup authenticator",
                methodType: "totp" as const,
                userId: methodUser.id,
                verifiedAt: now,
              },
            ])
            .returning({ id: userMfaMethods.id });
          const primaryMethod = methods[0];
          const backupMethod = methods[1];
          assert.ok(primaryMethod);
          assert.ok(backupMethod);
          await database
            .update(userMfaSettings)
            .set({
              enforcementEnabled: true,
              enrollmentCompletedAt: now,
              recoveryCodesAcknowledgedAt: now,
            })
            .where(eq(userMfaSettings.userId, methodUser.id));

          await renameOwnMfaMethod(
            database,
            methodContext,
            primaryMethod.id,
            "Personal YubiKey",
            logger,
            now,
          );
          await assert.rejects(
            renameOwnMfaMethod(
              database,
              context,
              primaryMethod.id,
              "Not the actor's key",
              logger,
              now,
            ),
            MfaMethodNotFoundError,
          );

          const descriptor = {
            action: "mfa_disable" as const,
            mutation: { methodId: primaryMethod.id },
            targetUserId: methodUser.id,
          };
          const binding = { sessionId: "method-session", sessionVersion: 0 };
          await assert.rejects(
            removeOwnMfaMethod(
              database,
              methodContext,
              primaryMethod.id,
              { ...binding, token: undefined },
              logger,
              now,
            ),
            StepUpRequiredError,
          );
          const authorization = await issueStepUpAuthorization(
            database,
            methodContext,
            descriptor,
            binding,
            "webauthn",
            logger,
            now,
          );
          await insertSession(database, binding.sessionId, methodUser.id, 0);
          const removed = await removeOwnMfaMethod(
            database,
            methodContext,
            primaryMethod.id,
            { ...binding, token: authorization.token },
            logger,
            now,
          );
          assert.equal(removed.sessionVersion, 1);
          assert.equal(await sessionCountForUser(database, methodUser.id), 0);

          const methodStates = await database
            .select({
              disabledAt: userMfaMethods.disabledAt,
              id: userMfaMethods.id,
              isPrimary: userMfaMethods.isPrimary,
              label: userMfaMethods.label,
            })
            .from(userMfaMethods)
            .where(eq(userMfaMethods.userId, methodUser.id));
          assert.deepEqual(
            methodStates
              .map((method) => ({
                disabled: method.disabledAt !== null,
                id: method.id,
                isPrimary: method.isPrimary,
                label: method.label,
              }))
              .sort((left, right) => left.label.localeCompare(right.label)),
            [
              {
                disabled: false,
                id: backupMethod.id,
                isPrimary: true,
                label: "Backup authenticator",
              },
              {
                disabled: true,
                id: primaryMethod.id,
                isPrimary: false,
                label: "Personal YubiKey",
              },
            ],
          );

          const finalDescriptor = {
            action: "mfa_disable" as const,
            mutation: { methodId: backupMethod.id },
            targetUserId: methodUser.id,
          };
          const finalBinding = {
            sessionId: "last-method-session",
            sessionVersion: 1,
          };
          const finalAuthorization = await issueStepUpAuthorization(
            database,
            methodContext,
            finalDescriptor,
            finalBinding,
            "totp",
            logger,
            now,
          );
          await assert.rejects(
            removeOwnMfaMethod(
              database,
              methodContext,
              backupMethod.id,
              {
                ...finalBinding,
                token: finalAuthorization.token,
              },
              logger,
              now,
            ),
            LastMfaMethodError,
          );
          const [lastMethod] = await database
            .select({ disabledAt: userMfaMethods.disabledAt })
            .from(userMfaMethods)
            .where(eq(userMfaMethods.id, backupMethod.id));
          assert.equal(lastMethod?.disabledAt, null);

          const methodAudit = await database
            .select({ action: auditEvents.action })
            .from(auditEvents)
            .where(eq(auditEvents.actorUserId, methodUser.id));
          assert.deepEqual(
            methodAudit.map(({ action }) => action).sort(),
            [
              "user_mfa_method_removed",
              "user_mfa_method_renamed",
              "user_mfa_step_up_succeeded",
              "user_mfa_step_up_succeeded",
            ],
          );
        });

        await t.test("step-up tokens are exact-bound, expiring, and one-use", async () => {
          const now = new Date("2026-07-21T18:05:00.000Z");
          const binding = { sessionId: "exact-session", sessionVersion: 2 };
          const descriptor = {
            action: "admin_staff_update" as const,
            mutation: { email: "exact@example.test" },
            targetUserId: staffTarget.id,
          };
          const authorization = await issueStepUpAuthorization(
            database,
            context,
            descriptor,
            binding,
            "totp",
            logger,
            now,
          );
          const mismatches: StepUpProof[] = [
            { ...binding, descriptor, sessionId: "other-session", token: authorization.token },
            { ...binding, descriptor, sessionVersion: 3, token: authorization.token },
            {
              ...binding,
              descriptor: { ...descriptor, mutation: { email: "other@example.test" } },
              token: authorization.token,
            },
            {
              ...binding,
              descriptor: { ...descriptor, action: "temporary_password" },
              token: authorization.token,
            },
            {
              ...binding,
              descriptor: { ...descriptor, targetUserId: policyTarget.id },
              token: authorization.token,
            },
          ];
          for (const proof of mismatches) {
            await assert.rejects(
              consumeStepUpAuthorization(database, context, proof, now),
              StepUpRequiredError,
            );
          }
          await consumeStepUpAuthorization(
            database,
            context,
            { ...binding, descriptor, token: authorization.token },
            now,
          );
          await assert.rejects(
            consumeStepUpAuthorization(
              database,
              context,
              { ...binding, descriptor, token: authorization.token },
              now,
            ),
            StepUpRequiredError,
          );

          const stale = await issueStepUpAuthorization(
            database,
            context,
            descriptor,
            binding,
            "totp",
            logger,
            now,
          );
          await assert.rejects(
            consumeStepUpAuthorization(
              database,
              context,
              { ...binding, descriptor, token: stale.token },
              new Date(now.getTime() + 5 * 60 * 1_000 + 1),
            ),
            StepUpRequiredError,
          );
        });

        await t.test("all sensitive account mutations require matching step-up", async () => {
          const rate = {
            effectiveDate: "2026-07-21",
            newBrokerRate: "10.00",
            newCommissionRate: "40.00",
            renewalBrokerRate: "10.00",
            renewalCommissionRate: "35.00",
          };
          const roleMutation = { initialRate: rate, role: "producer" as const };
          await assert.rejects(
            updateAdminStaff(
              database,
              context,
              staffTarget.id,
              roleMutation,
              logger,
            ),
            StepUpRequiredError,
          );
          const [unchangedRole] = await database
            .select({ role: staffProfiles.role })
            .from(staffProfiles)
            .where(eq(staffProfiles.userId, staffTarget.id));
          assert.equal(unchangedRole?.role, "employee");
          await updateAdminStaff(
            database,
            context,
            staffTarget.id,
            roleMutation,
            logger,
            await proofFor(database, context, {
              action: "admin_staff_update",
              mutation: roleMutation,
              targetUserId: staffTarget.id,
            }),
          );

          const temporaryMutation = { temporaryPassword: TEMPORARY_PASSWORD };
          await assert.rejects(
            issueAdminTemporaryPassword(
              database,
              context,
              staffTarget.id,
              temporaryMutation,
              logger,
            ),
            StepUpRequiredError,
          );
          await issueAdminTemporaryPassword(
            database,
            context,
            staffTarget.id,
            temporaryMutation,
            logger,
            await proofFor(database, context, {
              action: "temporary_password",
              mutation: temporaryMutation,
              targetUserId: staffTarget.id,
            }),
          );
          const [temporaryCredentials] = await database
            .select({ passwordHash: users.passwordHash })
            .from(users)
            .where(eq(users.id, staffTarget.id));
          assert.ok(temporaryCredentials);
          assert.equal(
            await verifyPassword(
              TEMPORARY_PASSWORD,
              temporaryCredentials.passwordHash,
            ),
            true,
          );

          const emailMutation = { email: `mfa-updated.${runId}@example.test` };
          await assert.rejects(
            updateAdminAccountEmail(
              database,
              context,
              staffTarget.id,
              emailMutation,
              missingProof(staffTarget.id, "admin_staff_update", emailMutation),
              logger,
            ),
            StepUpRequiredError,
          );
          await updateAdminAccountEmail(
            database,
            context,
            staffTarget.id,
            emailMutation,
            await proofFor(database, context, {
              action: "admin_staff_update",
              mutation: emailMutation,
              targetUserId: staffTarget.id,
            }),
            logger,
          );
          const [updatedEmail] = await database
            .select({ email: users.email })
            .from(users)
            .where(eq(users.id, staffTarget.id));
          assert.equal(updatedEmail?.email, emailMutation.email);

          const capabilityMutation = { enabled: true };
          await assert.rejects(
            setAdminCapability(
              database,
              context,
              policyTarget.id,
              capabilityMutation,
              missingProof(
                policyTarget.id,
                "admin_capability_change",
                capabilityMutation,
              ),
              true,
              logger,
            ),
            StepUpRequiredError,
          );
          await setAdminCapability(
            database,
            context,
            policyTarget.id,
            capabilityMutation,
            await proofFor(database, context, {
              action: "admin_capability_change",
              mutation: capabilityMutation,
              targetUserId: policyTarget.id,
            }),
            true,
            logger,
          );
          const [requiredPolicy] = await database
            .select({ policyRequiredAt: userMfaSettings.policyRequiredAt })
            .from(userMfaSettings)
            .where(eq(userMfaSettings.userId, policyTarget.id));
          assert.ok(requiredPolicy?.policyRequiredAt);

          await ensureMfaSettings(database, resetTarget.id);
          await database.insert(userMfaMethods).values({
            isPrimary: true,
            label: "Reset fixture passkey",
            methodType: "webauthn",
            userId: resetTarget.id,
            verifiedAt: new Date(),
          });
          const resetMutation = { reason: "Lost all account factors" };
          await assert.rejects(
            resetAdminMfa(
              database,
              context,
              resetTarget.id,
              resetMutation,
              missingProof(resetTarget.id, "mfa_reset", resetMutation),
              logger,
            ),
            StepUpRequiredError,
          );
          await resetAdminMfa(
            database,
            context,
            resetTarget.id,
            resetMutation,
            await proofFor(database, context, {
              action: "mfa_reset",
              mutation: resetMutation,
              targetUserId: resetTarget.id,
            }),
            logger,
          );
          const [resetPolicy] = await database
            .select({ policyRequiredAt: userMfaSettings.policyRequiredAt })
            .from(userMfaSettings)
            .where(eq(userMfaSettings.userId, resetTarget.id));
          assert.ok(resetPolicy?.policyRequiredAt);

          const disableMutation = { enabled: false };
          const disableProof = await proofFor(database, context, {
            action: "mfa_disable",
            mutation: disableMutation,
            targetUserId: actor.id,
          });
          await assert.rejects(
            disableOwnMfa(
              database,
              context,
              disableProof,
              { adminEnforcementEnabled: true, isAdmin: true },
              logger,
            ),
            MfaPolicyRequiredError,
          );
          await insertSession(database, "actor-before-disable", actor.id, 2);
          const disabled = await disableOwnMfa(
            database,
            context,
            disableProof,
            { adminEnforcementEnabled: false, isAdmin: true },
            logger,
          );
          assert.equal(disabled.sessionVersion, 3);
          assert.equal(await sessionCount(database), 0);
          const [disabledSettings] = await database
            .select({ enforcementEnabled: userMfaSettings.enforcementEnabled })
            .from(userMfaSettings)
            .where(eq(userMfaSettings.userId, actor.id));
          assert.equal(disabledSettings?.enforcementEnabled, false);
          const activeMethods = await database
            .select({ id: userMfaMethods.id })
            .from(userMfaMethods)
            .where(eq(userMfaMethods.userId, actor.id));
          assert.ok(activeMethods.length > 0);
          const methodStates = await database
            .select({ disabledAt: userMfaMethods.disabledAt })
            .from(userMfaMethods)
            .where(eq(userMfaMethods.userId, actor.id));
          assert.ok(methodStates.every(({ disabledAt }) => disabledAt !== null));
        });

        const serializedAudit = JSON.stringify(
          await database.select().from(auditEvents),
        );
        const serializedStepUps = JSON.stringify(
          await database.select().from(mfaStepUpAuthorizations),
        );
        for (const secret of [PASSWORD, TEMPORARY_PASSWORD]) {
          assert.equal(serializedAudit.includes(secret), false);
          assert.equal(serializedStepUps.includes(secret), false);
        }
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

function employeeContext(userId: string): AuthorizedRequestContext {
  return {
    authentication: { state: "mfa_recovery" },
    principal: {
      capabilities: [],
      staffRole: "employee",
      userActive: true,
      userId,
    },
  };
}

function totpCode(secret: string, now: Date): string {
  return generateSync({
    digits: 6,
    epoch: Math.floor(now.getTime() / 1_000),
    period: 30,
    secret,
  });
}

async function insertSession(
  database: AuthDatabase,
  sid: string,
  userId: string,
  sessionVersion: number,
): Promise<void> {
  await database.insert(sessions).values({
    expire: new Date(Date.now() + 60 * 60 * 1_000),
    sess: {
      authenticationState: "authenticated",
      cookie: {},
      sessionVersion,
      userId,
    },
    sid,
  });
}

async function sessionCount(database: AuthDatabase): Promise<number> {
  return (await database.select({ sid: sessions.sid }).from(sessions)).length;
}

async function sessionCountForUser(
  database: AuthDatabase,
  userId: string,
): Promise<number> {
  const rows = await database.select({ session: sessions.sess }).from(sessions);
  return rows.filter(
    ({ session }) =>
      session !== null &&
      typeof session === "object" &&
      (session as { userId?: unknown }).userId === userId,
  ).length;
}

async function proofFor(
  database: AuthDatabase,
  context: AuthorizedRequestContext,
  descriptor: StepUpProof["descriptor"],
): Promise<StepUpProof> {
  const binding = { sessionId: "protected-mutation-session", sessionVersion: 2 };
  const authorization = await issueStepUpAuthorization(
    database,
    context,
    descriptor,
    binding,
    "totp",
    logger,
  );
  return { ...binding, descriptor, token: authorization.token };
}

function missingProof(
  targetUserId: string,
  action: StepUpProof["descriptor"]["action"],
  mutation: Record<string, unknown>,
): StepUpProof {
  return {
    descriptor: { action, mutation, targetUserId },
    sessionId: "protected-mutation-session",
    sessionVersion: 2,
    token: undefined,
  };
}
