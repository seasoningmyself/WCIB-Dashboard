import type { Request, Response } from "express";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import {
  acknowledgeRecoveryCodesRequestSchema,
  confirmTotpEnrollmentRequestSchema,
  mfaChallengeResultSchema,
  mfaMethodParamsSchema,
  mfaRecoveryChallengeRequestSchema,
  mfaSettingsResponseSchema,
  mfaStepUpResponseSchema,
  mfaStepUpTotpRequestSchema,
  mfaStepUpWebAuthnFinishRequestSchema,
  mfaStepUpWebAuthnStartRequestSchema,
  mfaTotpChallengeRequestSchema,
  recoveryCodesResponseSchema,
  startTotpEnrollmentRequestSchema,
  startTotpEnrollmentResponseSchema,
  updateMfaMethodRequestSchema,
  webAuthnCredentialRequestSchema,
  webAuthnOptionsResponseSchema,
  type MfaStepUpDescriptor,
} from "../../shared/mfa-scaffold.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import type { MfaConfig } from "../config/mfa.js";
import {
  AUTHENTICATED_ACCESS,
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import {
  acknowledgeRecoveryCodes,
  regenerateRecoveryCodes,
} from "../auth/mfa-enrollment.js";
import { writeMfaAudit } from "../auth/mfa-audit.js";
import { hashMfaValue } from "../auth/mfa-crypto.js";
import {
  createDatabaseLoginThrottle,
  type LoginThrottle,
  type LoginThrottleDecision,
} from "../auth/login-throttle.js";
import {
  disableOwnMfa,
  LastMfaMethodError,
  MfaMethodNotFoundError,
  MfaPolicyRequiredError,
  removeOwnMfaMethod,
  renameOwnMfaMethod,
} from "../auth/mfa-management.js";
import { consumeRecoveryCode } from "../auth/mfa-recovery.js";
import { loadMfaAccessState, loadMfaState } from "../auth/mfa-state.js";
import {
  issueStepUpAuthorization,
  mutationDigest,
  recordStepUpFailure,
  verifyStepUpPassword,
  type StepUpSessionBinding,
} from "../auth/mfa-step-up.js";
import {
  confirmTotpEnrollment,
  InvalidMfaChallengeError,
  MfaMethodExistsError,
  startTotpEnrollment,
  verifyTotpForUser,
} from "../auth/mfa-totp.js";
import {
  confirmWebAuthnRegistration,
  startWebAuthnAuthentication,
  startWebAuthnRegistration,
  verifyWebAuthnAuthentication,
} from "../auth/mfa-webauthn.js";
import {
  continueMfaSession,
  establishMfaSession,
} from "../auth/sessions.js";
import { findUserById, type AuthDatabase, type UserAccount } from "../auth/users.js";
import type { AppLogger } from "../logging/logger.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const MFA_SETTINGS_PATH = "/api/mfa/settings";
export const MFA_METHOD_PATH = "/api/mfa/methods/:methodId";
export const MFA_TOTP_START_PATH = "/api/mfa/enrollment/totp/start";
export const MFA_TOTP_CONFIRM_PATH = "/api/mfa/enrollment/totp/confirm";
export const MFA_PASSKEY_START_PATH = "/api/mfa/enrollment/passkey/options";
export const MFA_PASSKEY_CONFIRM_PATH = "/api/mfa/enrollment/passkey/verify";
export const MFA_RECOVERY_CODES_PATH = "/api/mfa/recovery-codes/regenerate";
export const MFA_RECOVERY_ACK_PATH = "/api/mfa/recovery-codes/acknowledge";
export const MFA_DISABLE_PATH = "/api/mfa";
export const MFA_LOGIN_TOTP_PATH = "/api/auth/mfa/totp";
export const MFA_LOGIN_PASSKEY_START_PATH = "/api/auth/mfa/passkey/options";
export const MFA_LOGIN_PASSKEY_FINISH_PATH = "/api/auth/mfa/passkey/verify";
export const MFA_LOGIN_RECOVERY_PATH = "/api/auth/mfa/recovery";
export const MFA_STEP_UP_TOTP_PATH = "/api/auth/step-up/totp";
export const MFA_STEP_UP_PASSKEY_START_PATH =
  "/api/auth/step-up/passkey/options";
export const MFA_STEP_UP_PASSKEY_FINISH_PATH =
  "/api/auth/step-up/passkey/verify";

export interface RegisterMfaRoutesOptions {
  authorization: AuthorizationGuards;
  config: MfaConfig;
  database: AuthDatabase;
  logger: AppLogger;
  loginThrottleSecret: string;
}

export function registerMfaRoutes(
  routes: RouteRegistrar,
  options: RegisterMfaRoutesOptions,
): void {
  const throttle = createDatabaseLoginThrottle(
    options.database,
    options.loginThrottleSecret,
    options.logger,
  );
  const allMfaStates = {
    authorization: options.authorization.require(AUTHENTICATED_ACCESS, {
      allowMfaChallenge: true,
      allowMfaEnrollment: true,
      allowMfaRecovery: true,
    }),
  } as const;
  const enrollmentAccess = {
    authorization: options.authorization.require(AUTHENTICATED_ACCESS, {
      allowMfaEnrollment: true,
      allowMfaRecovery: true,
    }),
  } as const;
  const challengeAccess = {
    authorization: options.authorization.require(AUTHENTICATED_ACCESS, {
      allowMfaChallenge: true,
    }),
  } as const;
  const normalAccess = {
    authorization: options.authorization.require(AUTHENTICATED_ACCESS),
  } as const;

  routes.get(
    MFA_SETTINGS_PATH,
    allMfaStates,
    asyncRoute(async (_req, res) => {
      const context = getAuthorizedRequestContext(res);
      await respondWithMfaState(res, options, context);
    }),
  );
  routes.patch(
    MFA_METHOD_PATH,
    normalAccess,
    asyncRoute(async (req, res) => {
      const context = getAuthorizedRequestContext(res);
      const { methodId } = mfaMethodParamsSchema.parse(req.params);
      const { label } = updateMfaMethodRequestSchema.parse(req.body);
      try {
        await renameOwnMfaMethod(
          options.database,
          context,
          methodId,
          label,
          options.logger,
        );
      } catch (error) {
        if (error instanceof MfaMethodNotFoundError) {
          throw new HttpError(404, apiErrorCodes.notFound, error.message);
        }
        throw error;
      }
      await respondWithMfaState(res, options, context);
    }),
  );
  routes.delete(
    MFA_METHOD_PATH,
    normalAccess,
    asyncRoute(async (req, res) => {
      const context = getAuthorizedRequestContext(res);
      const { methodId } = mfaMethodParamsSchema.parse(req.params);
      try {
        const user = await removeOwnMfaMethod(
          options.database,
          context,
          methodId,
          {
            ...sessionBinding(req),
            token: readStepUpToken(req),
          },
          options.logger,
        );
        await establishMfaSession(req, user, "authenticated");
      } catch (error) {
        if (error instanceof MfaMethodNotFoundError) {
          throw new HttpError(404, apiErrorCodes.notFound, error.message);
        }
        if (error instanceof LastMfaMethodError) {
          throw new HttpError(409, apiErrorCodes.badRequest, error.message);
        }
        throw error;
      }
      await respondWithMfaState(res, options, context);
    }),
  );
  routes.post(
    MFA_TOTP_START_PATH,
    enrollmentAccess,
    asyncRoute(async (req, res) => {
      const context = getAuthorizedRequestContext(res);
      const input = startTotpEnrollmentRequestSchema.parse(req.body);
      const user = await requireUser(options.database, context.principal.userId);
      try {
        const started = await startTotpEnrollment(
          options.database,
          user,
          input.label,
          options.config.encryptionKeys,
        );
        res.set("Cache-Control", "no-store").json(
          startTotpEnrollmentResponseSchema.parse({
            ...started,
            expiresAt: started.expiresAt.toISOString(),
          }),
        );
      } catch (error) {
        if (error instanceof MfaMethodExistsError) {
          throw new HttpError(409, apiErrorCodes.badRequest, error.message);
        }
        throw error;
      }
    }),
  );
  routes.post(
    MFA_TOTP_CONFIRM_PATH,
    enrollmentAccess,
    asyncRoute(async (req, res) => {
      const context = getAuthorizedRequestContext(res);
      const input = confirmTotpEnrollmentRequestSchema.parse(req.body);
      const user = await requireUser(options.database, context.principal.userId);
      const keys = throttleKeys(req, user);
      await assertNotThrottled(throttle, keys, res);
      try {
        const result = await confirmTotpEnrollment(
          options.database,
          context,
          input.methodId,
          input.code,
          options.config.encryptionKeys,
          options.logger,
        );
        await throttle.clearAccount(keys.account);
        await establishMfaSession(
          req,
          result.user,
          result.requiresRecoveryAcknowledgement
            ? "mfa_enrollment"
            : "authenticated",
          context.authentication?.recoveryGrantId,
        );
        await respondWithRecoveryCodes(
          res,
          options,
          context,
          result.recoveryCodes,
        );
      } catch (error) {
        if (error instanceof InvalidMfaChallengeError) {
          await recordMfaFailure(
            options,
            context,
            "totp",
            "enrollment_verification_failed",
          );
          await recordFailureOrThrow(throttle, keys, res);
          throw invalidMfaChallenge();
        }
        throw error;
      }
    }),
  );
  routes.post(
    MFA_PASSKEY_START_PATH,
    enrollmentAccess,
    asyncRoute(async (_req, res) => {
      const context = getAuthorizedRequestContext(res);
      const user = await requireUser(options.database, context.principal.userId);
      const started = await startWebAuthnRegistration(
        options.database,
        user,
        options.config.webAuthn,
      );
      res.set("Cache-Control", "no-store").json(
        webAuthnOptionsResponseSchema.parse({
          challengeId: started.challengeId,
          expiresAt: started.expiresAt.toISOString(),
          options: started.options,
        }),
      );
    }),
  );
  routes.post(
    MFA_PASSKEY_CONFIRM_PATH,
    enrollmentAccess,
    asyncRoute(async (req, res) => {
      const context = getAuthorizedRequestContext(res);
      const input = webAuthnCredentialRequestSchema.parse(req.body);
      try {
        const result = await confirmWebAuthnRegistration(
          options.database,
          context,
          {
            challengeId: input.challengeId,
            credential: input.credential as unknown as RegistrationResponseJSON,
            label: input.label,
          },
          options.config.webAuthn,
          options.logger,
        );
        await establishMfaSession(
          req,
          result.user,
          result.requiresRecoveryAcknowledgement
            ? "mfa_enrollment"
            : "authenticated",
          context.authentication?.recoveryGrantId,
        );
        await respondWithRecoveryCodes(
          res,
          options,
          context,
          result.recoveryCodes,
        );
      } catch (error) {
        if (error instanceof InvalidMfaChallengeError) {
          await recordMfaFailure(
            options,
            context,
            "webauthn",
            "enrollment_verification_failed",
          );
          throw invalidMfaChallenge();
        }
        throw error;
      }
    }),
  );
  routes.post(
    MFA_RECOVERY_CODES_PATH,
    enrollmentAccess,
    asyncRoute(async (req, res) => {
      const context = getAuthorizedRequestContext(res);
      const access = await loadMfaAccessState(
        options.database,
        context.principal.userId,
        policyOptions(options, context),
      );
      if (access.activeMethodCount === 0) {
        throw new HttpError(
          409,
          apiErrorCodes.badRequest,
          "Enroll an MFA method before generating recovery codes",
        );
      }
      const result = await regenerateRecoveryCodes(
        options.database,
        context,
        options.logger,
      );
      await establishMfaSession(
        req,
        result.user,
        "mfa_enrollment",
        context.authentication?.recoveryGrantId,
      );
      await respondWithRecoveryCodes(
        res,
        options,
        context,
        result.codes,
      );
    }),
  );
  routes.post(
    MFA_RECOVERY_ACK_PATH,
    enrollmentAccess,
    asyncRoute(async (req, res) => {
      acknowledgeRecoveryCodesRequestSchema.parse(req.body);
      const context = getAuthorizedRequestContext(res);
      const user = await acknowledgeRecoveryCodes(
        options.database,
        context,
        context.authentication?.recoveryGrantId,
        options.logger,
      );
      await establishMfaSession(req, user, "authenticated");
      res.status(204).end();
    }),
  );

  routes.post(
    MFA_LOGIN_TOTP_PATH,
    challengeAccess,
    asyncRoute(async (req, res) => {
      const context = getAuthorizedRequestContext(res);
      requireAuthenticationState(context, "mfa_challenge");
      const input = mfaTotpChallengeRequestSchema.parse(req.body);
      const user = await requireUser(options.database, context.principal.userId);
      const keys = throttleKeys(req, user);
      await assertNotThrottled(throttle, keys, res);
      const methodId = await verifyTotpForUser(
        options.database,
        user.id,
        input.code,
        options.config.encryptionKeys,
      );
      if (methodId === null) {
        await recordMfaFailure(options, context, "totp", "invalid_factor");
        await recordFailureOrThrow(throttle, keys, res);
        throw invalidMfaChallenge();
      }
      await completeMfaLogin(req, res, options, throttle, keys, context, user, "totp");
    }),
  );
  routes.post(
    MFA_LOGIN_PASSKEY_START_PATH,
    challengeAccess,
    asyncRoute(async (req, res) => {
      const context = getAuthorizedRequestContext(res);
      requireAuthenticationState(context, "mfa_challenge");
      const user = await requireUser(options.database, context.principal.userId);
      const keys = throttleKeys(req, user);
      await assertNotThrottled(throttle, keys, res);
      const started = await startWebAuthnAuthentication(
        options.database,
        user.id,
        "webauthn_authentication",
        options.config.webAuthn,
      );
      if (started === null) {
        await recordMfaFailure(options, context, "webauthn", "method_unavailable");
        await recordFailureOrThrow(throttle, keys, res);
        throw invalidMfaChallenge();
      }
      res.set("Cache-Control", "no-store").json(
        webAuthnOptionsResponseSchema.parse({
          challengeId: started.challengeId,
          expiresAt: started.expiresAt.toISOString(),
          options: started.options,
        }),
      );
    }),
  );
  routes.post(
    MFA_LOGIN_PASSKEY_FINISH_PATH,
    challengeAccess,
    asyncRoute(async (req, res) => {
      const context = getAuthorizedRequestContext(res);
      requireAuthenticationState(context, "mfa_challenge");
      const input = webAuthnCredentialRequestSchema.parse(req.body);
      const user = await requireUser(options.database, context.principal.userId);
      const keys = throttleKeys(req, user);
      await assertNotThrottled(throttle, keys, res);
      const verified = await verifyWebAuthnAuthentication(
        options.database,
        user.id,
        {
          challengeId: input.challengeId,
          credential: input.credential as unknown as AuthenticationResponseJSON,
          purpose: "webauthn_authentication",
        },
        options.config.webAuthn,
      );
      if (verified === null) {
        await recordMfaFailure(options, context, "webauthn", "invalid_factor");
        await recordFailureOrThrow(throttle, keys, res);
        throw invalidMfaChallenge();
      }
      await completeMfaLogin(
        req,
        res,
        options,
        throttle,
        keys,
        context,
        user,
        "webauthn",
      );
    }),
  );
  routes.post(
    MFA_LOGIN_RECOVERY_PATH,
    challengeAccess,
    asyncRoute(async (req, res) => {
      const context = getAuthorizedRequestContext(res);
      requireAuthenticationState(context, "mfa_challenge");
      const input = mfaRecoveryChallengeRequestSchema.parse(req.body);
      const user = await requireUser(options.database, context.principal.userId);
      const keys = throttleKeys(req, user);
      await assertNotThrottled(throttle, keys, res);
      const recovered = await consumeRecoveryCode(
        options.database,
        context,
        input.code,
        req.sessionID,
        options.logger,
      );
      if (recovered === null) {
        await recordMfaFailure(
          options,
          context,
          "recovery_code",
          "invalid_recovery_code",
        );
        await recordFailureOrThrow(throttle, keys, res);
        throw invalidMfaChallenge();
      }
      await throttle.clearAccount(keys.account);
      await continueMfaSession(
        req,
        recovered.user,
        "mfa_recovery",
        recovered.grantId,
      );
      res.json(mfaChallengeResultSchema.parse({ userId: recovered.user.id }));
    }),
  );

  routes.post(
    MFA_STEP_UP_TOTP_PATH,
    normalAccess,
    asyncRoute(async (req, res) => {
      const context = getAuthorizedRequestContext(res);
      const input = mfaStepUpTotpRequestSchema.parse(req.body);
      const user = await requireUser(options.database, context.principal.userId);
      const keys = throttleKeys(req, user);
      await assertNotThrottled(throttle, keys, res);
      const passwordValid = await verifyStepUpPassword(
        options.database,
        user.id,
        input.currentPassword,
      );
      const methodId = passwordValid
        ? await verifyTotpForUser(
            options.database,
            user.id,
            input.code,
            options.config.encryptionKeys,
          )
        : null;
      if (!passwordValid || methodId === null) {
        await recordStepUpFailure(
          options.database,
          context,
          input.descriptor,
          "totp",
          "verification_failed",
          options.logger,
        );
        await recordFailureOrThrow(throttle, keys, res);
        throw invalidStepUp();
      }
      const result = await issueStepUpAuthorization(
        options.database,
        context,
        input.descriptor,
        sessionBinding(req),
        "totp",
        options.logger,
      );
      await throttle.clearAccount(keys.account);
      res.set("Cache-Control", "no-store").json(
        mfaStepUpResponseSchema.parse({
          expiresAt: result.expiresAt.toISOString(),
          token: result.token,
        }),
      );
    }),
  );
  routes.post(
    MFA_STEP_UP_PASSKEY_START_PATH,
    normalAccess,
    asyncRoute(async (req, res) => {
      const context = getAuthorizedRequestContext(res);
      const input = mfaStepUpWebAuthnStartRequestSchema.parse(req.body);
      const user = await requireUser(options.database, context.principal.userId);
      const keys = throttleKeys(req, user);
      await assertNotThrottled(throttle, keys, res);
      if (
        !(await verifyStepUpPassword(
          options.database,
          user.id,
          input.currentPassword,
        ))
      ) {
        await recordStepUpFailure(
          options.database,
          context,
          input.descriptor,
          "webauthn",
          "invalid_password",
          options.logger,
        );
        await recordFailureOrThrow(throttle, keys, res);
        throw invalidStepUp();
      }
      const binding = sessionBinding(req);
      const started = await startWebAuthnAuthentication(
        options.database,
        user.id,
        "step_up_webauthn",
        options.config.webAuthn,
        {
          actionType: input.descriptor.action,
          mutationDigest: mutationDigest(input.descriptor.mutation),
          sessionIdHash: hashMfaValue(binding.sessionId),
          sessionVersion: binding.sessionVersion,
          targetUserId: input.descriptor.targetUserId,
        },
      );
      if (started === null) {
        await recordStepUpFailure(
          options.database,
          context,
          input.descriptor,
          "webauthn",
          "method_unavailable",
          options.logger,
        );
        await recordFailureOrThrow(throttle, keys, res);
        throw invalidStepUp();
      }
      res.set("Cache-Control", "no-store").json(
        webAuthnOptionsResponseSchema.parse({
          challengeId: started.challengeId,
          expiresAt: started.expiresAt.toISOString(),
          options: started.options,
        }),
      );
    }),
  );
  routes.post(
    MFA_STEP_UP_PASSKEY_FINISH_PATH,
    normalAccess,
    asyncRoute(async (req, res) => {
      const context = getAuthorizedRequestContext(res);
      const input = mfaStepUpWebAuthnFinishRequestSchema.parse(req.body);
      const user = await requireUser(options.database, context.principal.userId);
      const keys = throttleKeys(req, user);
      await assertNotThrottled(throttle, keys, res);
      const verified = await verifyWebAuthnAuthentication(
        options.database,
        user.id,
        {
          challengeId: input.challengeId,
          credential: input.credential as unknown as AuthenticationResponseJSON,
          purpose: "step_up_webauthn",
        },
        options.config.webAuthn,
      );
      if (
        verified?.binding === null ||
        verified === null ||
        !bindingMatches(verified.binding, input.descriptor, req)
      ) {
        await recordStepUpFailure(
          options.database,
          context,
          input.descriptor,
          "webauthn",
          "verification_failed",
          options.logger,
        );
        await recordFailureOrThrow(throttle, keys, res);
        throw invalidStepUp();
      }
      const result = await issueStepUpAuthorization(
        options.database,
        context,
        input.descriptor,
        sessionBinding(req),
        "webauthn",
        options.logger,
      );
      await throttle.clearAccount(keys.account);
      res.set("Cache-Control", "no-store").json(
        mfaStepUpResponseSchema.parse({
          expiresAt: result.expiresAt.toISOString(),
          token: result.token,
        }),
      );
    }),
  );
  routes.delete(
    MFA_DISABLE_PATH,
    normalAccess,
    asyncRoute(async (req, res) => {
      const context = getAuthorizedRequestContext(res);
      const descriptor = {
        action: "mfa_disable",
        mutation: { enabled: false },
        targetUserId: context.principal.userId,
      } as const;
      try {
        const user = await disableOwnMfa(
          options.database,
          context,
          {
            ...sessionBinding(req),
            descriptor,
            token: readStepUpToken(req),
          },
          policyOptions(options, context),
          options.logger,
        );
        await establishMfaSession(req, user, "authenticated");
        res.status(204).end();
      } catch (error) {
        if (error instanceof MfaPolicyRequiredError) {
          throw new HttpError(409, apiErrorCodes.badRequest, error.message);
        }
        throw error;
      }
    }),
  );
}

async function completeMfaLogin(
  req: Request,
  res: Response,
  options: RegisterMfaRoutesOptions,
  throttle: LoginThrottle,
  keys: { account: string; ip: string },
  context: AuthorizedRequestContext,
  user: UserAccount,
  method: "totp" | "webauthn",
): Promise<void> {
  const state = await loadMfaAccessState(
    options.database,
    user.id,
    policyOptions(options, context),
  );
  await options.database.transaction(async (transaction) => {
    await writeMfaAudit(
      transaction as AuthDatabase,
      context,
      {
        action: "user_mfa_challenge_succeeded",
        method,
        outcome: "success",
      },
      options.logger,
    );
  });
  await throttle.clearAccount(keys.account);
  await establishMfaSession(
    req,
    user,
    state.enrollmentIncomplete ? "mfa_enrollment" : "authenticated",
  );
  res.json(mfaChallengeResultSchema.parse({ userId: user.id }));
}

async function respondWithMfaState(
  res: Response,
  options: RegisterMfaRoutesOptions,
  context: AuthorizedRequestContext,
): Promise<void> {
  const mfa = await loadMfaState(
    options.database,
    context.principal.userId,
    policyOptions(options, context),
  );
  const projected = projectAuthorizedFields(
    res,
    { mfa, userId: context.principal.userId },
    (source, trustedContext) =>
      source.userId === trustedContext.principal.userId
        ? mfaSettingsResponseSchema.parse({ mfa: source.mfa })
        : null,
  );
  if (projected === null) {
    throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  res.set("Cache-Control", "no-store").json(projected);
}

async function respondWithRecoveryCodes(
  res: Response,
  options: RegisterMfaRoutesOptions,
  context: AuthorizedRequestContext,
  codes: string[],
): Promise<void> {
  if (codes.length === 0) {
    await respondWithMfaState(res, options, context);
    return;
  }
  const mfa = await loadMfaState(
    options.database,
    context.principal.userId,
    policyOptions(options, context),
  );
  res.set("Cache-Control", "no-store").json(
    recoveryCodesResponseSchema.parse({ codes, mfa }),
  );
}

async function requireUser(
  database: AuthDatabase,
  userId: string,
): Promise<UserAccount> {
  const user = await findUserById(database, userId);
  if (user === null || !user.isActive) {
    throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  return user;
}

function policyOptions(
  options: RegisterMfaRoutesOptions,
  context: AuthorizedRequestContext,
) {
  return {
    adminEnforcementEnabled: options.config.adminEnforcementEnabled,
    allUsersEnforcementEnabled: options.config.allUsersEnforcementEnabled,
    isAdmin: context.principal.capabilities.includes("admin"),
    isSupportEngineer:
      context.principal.capabilities.includes("support_engineer"),
  };
}

function requireAuthenticationState(
  context: AuthorizedRequestContext,
  expected: "mfa_challenge",
): void {
  if (context.authentication?.state !== expected) {
    throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
}

function throttleKeys(req: Request, user: UserAccount) {
  return {
    account: user.email,
    ip: req.ip || req.socket.remoteAddress || "unknown",
  };
}

async function assertNotThrottled(
  throttle: LoginThrottle,
  keys: { account: string; ip: string },
  res: Response,
): Promise<void> {
  const decision = await throttle.check(keys);
  if (decision !== null) throwTooManyAttempts(res, decision);
}

async function recordFailureOrThrow(
  throttle: LoginThrottle,
  keys: { account: string; ip: string },
  res: Response,
): Promise<void> {
  const decision = await throttle.recordFailure(keys);
  if (decision !== null) throwTooManyAttempts(res, decision);
}

function throwTooManyAttempts(
  res: Response,
  decision: LoginThrottleDecision,
): never {
  res.set("Retry-After", String(decision.retryAfterSeconds));
  throw new HttpError(
    429,
    apiErrorCodes.tooManyAttempts,
    "Too many attempts. Try again later.",
  );
}

async function recordMfaFailure(
  options: RegisterMfaRoutesOptions,
  context: AuthorizedRequestContext,
  method: "recovery_code" | "totp" | "webauthn",
  reason: string,
): Promise<void> {
  await options.database.transaction(async (transaction) => {
    await writeMfaAudit(
      transaction as AuthDatabase,
      context,
      {
        action: "user_mfa_challenge_failed",
        method,
        outcome: "failure",
        reason,
      },
      options.logger,
    );
  });
}

function sessionBinding(req: Request): StepUpSessionBinding {
  const sessionVersion = req.session.sessionVersion;
  if (!Number.isInteger(sessionVersion) || (sessionVersion ?? -1) < 0) {
    throw new HttpError(401, apiErrorCodes.unauthorized, "Authentication required");
  }
  return { sessionId: req.sessionID, sessionVersion: sessionVersion as number };
}

function bindingMatches(
  binding: {
    actionType: string;
    mutationDigest: string;
    sessionIdHash: string;
    sessionVersion: number;
    targetUserId: string;
  },
  descriptor: MfaStepUpDescriptor,
  req: Request,
): boolean {
  const session = sessionBinding(req);
  return (
    binding.actionType === descriptor.action &&
    binding.mutationDigest === mutationDigest(descriptor.mutation) &&
    binding.sessionIdHash === hashMfaValue(session.sessionId) &&
    binding.sessionVersion === session.sessionVersion &&
    binding.targetUserId === descriptor.targetUserId
  );
}

function readStepUpToken(req: Request): string | undefined {
  const value = req.header("X-WCIB-Step-Up");
  return value?.trim() || undefined;
}

function invalidMfaChallenge(): HttpError {
  return new HttpError(
    401,
    apiErrorCodes.invalidMfaChallenge,
    "Verification failed",
  );
}

function invalidStepUp(): HttpError {
  return new HttpError(
    403,
    apiErrorCodes.invalidMfaChallenge,
    "Step-up verification failed",
  );
}
