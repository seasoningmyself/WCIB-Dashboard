import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import { z } from "zod";
import { apiErrorCodes } from "../../../shared/api-errors.js";
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
  type MfaState,
  type MfaStepUpDescriptor,
} from "../../../shared/mfa-scaffold.js";
import { apiBaseUrl } from "../config.js";

export type MfaApiErrorKind =
  | "conflict"
  | "denied"
  | "invalid_challenge"
  | "invalid_response"
  | "throttled"
  | "unavailable"
  | "validation";

export class MfaApiError extends Error {
  constructor(
    readonly kind: MfaApiErrorKind,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super("MFA request could not be completed");
    this.name = "MfaApiError";
  }
}

export interface WebAuthnOptions<Options> {
  challengeId: string;
  expiresAt: string;
  options: Options;
}

export interface EnrollmentResult {
  mfa: MfaState;
  recoveryCodes: string[] | null;
}

export interface MfaApi {
  acknowledgeRecoveryCodes(): Promise<void>;
  confirmPasskeyEnrollment(
    challengeId: string,
    credential: RegistrationResponseJSON,
    label: string,
  ): Promise<EnrollmentResult>;
  confirmTotpEnrollment(methodId: string, code: string): Promise<EnrollmentResult>;
  disable(token: string): Promise<void>;
  finishPasskeyLogin(
    challengeId: string,
    credential: AuthenticationResponseJSON,
  ): Promise<void>;
  finishPasskeyStepUp(
    challengeId: string,
    credential: AuthenticationResponseJSON,
    descriptor: MfaStepUpDescriptor,
  ): Promise<{ expiresAt: string; token: string }>;
  loginWithRecoveryCode(code: string): Promise<void>;
  loginWithTotp(code: string): Promise<void>;
  loadSettings(): Promise<MfaState>;
  regenerateRecoveryCodes(): Promise<EnrollmentResult>;
  removeMethod(methodId: string, token: string): Promise<MfaState>;
  renameMethod(methodId: string, label: string): Promise<MfaState>;
  startPasskeyEnrollment(): Promise<
    WebAuthnOptions<PublicKeyCredentialCreationOptionsJSON>
  >;
  startPasskeyLogin(): Promise<
    WebAuthnOptions<PublicKeyCredentialRequestOptionsJSON>
  >;
  startPasskeyStepUp(
    currentPassword: string,
    descriptor: MfaStepUpDescriptor,
  ): Promise<WebAuthnOptions<PublicKeyCredentialRequestOptionsJSON>>;
  startTotpEnrollment(label: string): Promise<{
    expiresAt: string;
    methodId: string;
    otpauthUrl: string;
    secret: string;
  }>;
  stepUpWithTotp(
    currentPassword: string,
    code: string,
    descriptor: MfaStepUpDescriptor,
  ): Promise<{ expiresAt: string; token: string }>;
}

type MfaFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function createMfaApi(
  fetchRequest: MfaFetch = globalThis.fetch.bind(globalThis),
  baseUrl = apiBaseUrl,
): MfaApi {
  return {
    async acknowledgeRecoveryCodes() {
      const body = acknowledgeRecoveryCodesRequestSchema.parse({ saved: true });
      const response = await request(fetchRequest, baseUrl, "/mfa/recovery-codes/acknowledge", {
        body: JSON.stringify(body),
        headers: jsonHeaders,
        method: "POST",
      });
      if (response.status !== 204) throw await mapFailure(response);
    },
    async confirmPasskeyEnrollment(challengeId, credential, label) {
      const body = webAuthnCredentialRequestSchema.parse({
        challengeId,
        credential,
        label,
      });
      const response = await request(fetchRequest, baseUrl, "/mfa/enrollment/passkey/verify", {
        body: JSON.stringify(body),
        headers: jsonHeaders,
        method: "POST",
      });
      return parseEnrollmentResult(response);
    },
    async confirmTotpEnrollment(methodId, code) {
      const body = confirmTotpEnrollmentRequestSchema.parse({ code, methodId });
      const response = await request(fetchRequest, baseUrl, "/mfa/enrollment/totp/confirm", {
        body: JSON.stringify(body),
        headers: jsonHeaders,
        method: "POST",
      });
      return parseEnrollmentResult(response);
    },
    async disable(token) {
      const response = await request(fetchRequest, baseUrl, "/mfa", {
        headers: { Accept: "application/json", "X-WCIB-Step-Up": token },
        method: "DELETE",
      });
      if (response.status !== 204) throw await mapFailure(response);
    },
    async finishPasskeyLogin(challengeId, credential) {
      await finishChallenge(fetchRequest, baseUrl, "/auth/mfa/passkey/verify", {
        challengeId,
        credential,
      });
    },
    async finishPasskeyStepUp(challengeId, credential, descriptor) {
      const body = mfaStepUpWebAuthnFinishRequestSchema.parse({
        challengeId,
        credential,
        descriptor,
      });
      return parseStepUpResponse(
        await request(fetchRequest, baseUrl, "/auth/step-up/passkey/verify", {
          body: JSON.stringify(body),
          headers: jsonHeaders,
          method: "POST",
        }),
      );
    },
    async loginWithRecoveryCode(code) {
      const body = mfaRecoveryChallengeRequestSchema.parse({ code });
      await finishChallenge(fetchRequest, baseUrl, "/auth/mfa/recovery", body);
    },
    async loginWithTotp(code) {
      const body = mfaTotpChallengeRequestSchema.parse({ code });
      await finishChallenge(fetchRequest, baseUrl, "/auth/mfa/totp", body);
    },
    async loadSettings() {
      const response = await request(fetchRequest, baseUrl, "/mfa/settings", {
        cache: "no-store",
        headers: { Accept: "application/json" },
        method: "GET",
      });
      return (await parseJson(response, mfaSettingsResponseSchema)).mfa;
    },
    async regenerateRecoveryCodes() {
      const response = await request(fetchRequest, baseUrl, "/mfa/recovery-codes/regenerate", {
        headers: jsonHeaders,
        method: "POST",
      });
      return parseEnrollmentResult(response);
    },
    async removeMethod(methodId, token) {
      const params = mfaMethodParamsSchema.parse({ methodId });
      const response = await request(
        fetchRequest,
        baseUrl,
        `/mfa/methods/${encodeURIComponent(params.methodId)}`,
        {
          headers: { Accept: "application/json", "X-WCIB-Step-Up": token },
          method: "DELETE",
        },
      );
      return (await parseJson(response, mfaSettingsResponseSchema)).mfa;
    },
    async renameMethod(methodId, label) {
      const params = mfaMethodParamsSchema.parse({ methodId });
      const body = updateMfaMethodRequestSchema.parse({ label });
      const response = await request(
        fetchRequest,
        baseUrl,
        `/mfa/methods/${encodeURIComponent(params.methodId)}`,
        {
          body: JSON.stringify(body),
          headers: jsonHeaders,
          method: "PATCH",
        },
      );
      return (await parseJson(response, mfaSettingsResponseSchema)).mfa;
    },
    async startPasskeyEnrollment() {
      return parseWebAuthnOptions<PublicKeyCredentialCreationOptionsJSON>(
        await request(fetchRequest, baseUrl, "/mfa/enrollment/passkey/options", {
          headers: jsonHeaders,
          method: "POST",
        }),
      );
    },
    async startPasskeyLogin() {
      return parseWebAuthnOptions<PublicKeyCredentialRequestOptionsJSON>(
        await request(fetchRequest, baseUrl, "/auth/mfa/passkey/options", {
          headers: jsonHeaders,
          method: "POST",
        }),
      );
    },
    async startPasskeyStepUp(currentPassword, descriptor) {
      const body = mfaStepUpWebAuthnStartRequestSchema.parse({
        currentPassword,
        descriptor,
      });
      return parseWebAuthnOptions<PublicKeyCredentialRequestOptionsJSON>(
        await request(fetchRequest, baseUrl, "/auth/step-up/passkey/options", {
          body: JSON.stringify(body),
          headers: jsonHeaders,
          method: "POST",
        }),
      );
    },
    async startTotpEnrollment(label) {
      const body = startTotpEnrollmentRequestSchema.parse({ label });
      const response = await request(fetchRequest, baseUrl, "/mfa/enrollment/totp/start", {
        body: JSON.stringify(body),
        headers: jsonHeaders,
        method: "POST",
      });
      return parseJson(response, startTotpEnrollmentResponseSchema);
    },
    async stepUpWithTotp(currentPassword, code, descriptor) {
      const body = mfaStepUpTotpRequestSchema.parse({
        code,
        currentPassword,
        descriptor,
      });
      return parseStepUpResponse(
        await request(fetchRequest, baseUrl, "/auth/step-up/totp", {
          body: JSON.stringify(body),
          headers: jsonHeaders,
          method: "POST",
        }),
      );
    },
  };
}

const jsonHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json",
};

async function finishChallenge(
  fetchRequest: MfaFetch,
  baseUrl: string,
  path: string,
  input: unknown,
): Promise<void> {
  const response = await request(fetchRequest, baseUrl, path, {
    body: JSON.stringify(input),
    headers: jsonHeaders,
    method: "POST",
  });
  await parseJson(response, mfaChallengeResultSchema);
}

async function parseEnrollmentResult(response: Response): Promise<EnrollmentResult> {
  if (!response.ok) throw await mapFailure(response);
  const raw = await readJson(response);
  const withCodes = recoveryCodesResponseSchema.safeParse(raw);
  if (withCodes.success) {
    return { mfa: withCodes.data.mfa, recoveryCodes: withCodes.data.codes };
  }
  const settings = mfaSettingsResponseSchema.safeParse(raw);
  if (settings.success) {
    return { mfa: settings.data.mfa, recoveryCodes: null };
  }
  throw new MfaApiError("invalid_response");
}

async function parseStepUpResponse(response: Response) {
  return parseJson(response, mfaStepUpResponseSchema);
}

async function parseWebAuthnOptions<Options>(
  response: Response,
): Promise<WebAuthnOptions<Options>> {
  const parsed = await parseJson(response, webAuthnOptionsResponseSchema);
  return { ...parsed, options: parsed.options as Options };
}

async function parseJson<Schema extends z.ZodTypeAny>(
  response: Response,
  schema: Schema,
): Promise<z.output<Schema>> {
  if (!response.ok) throw await mapFailure(response);
  const parsed = schema.safeParse(await readJson(response));
  if (!parsed.success) throw new MfaApiError("invalid_response");
  return parsed.data;
}

async function request(
  fetchRequest: MfaFetch,
  baseUrl: string,
  path: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchRequest(`${baseUrl}${path}`, {
      ...init,
      credentials: "same-origin",
    });
  } catch {
    throw new MfaApiError("unavailable");
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new MfaApiError("invalid_response");
  }
}

async function mapFailure(response: Response): Promise<MfaApiError> {
  const code = await readErrorCode(response);
  if (response.status === 429 && code === apiErrorCodes.tooManyAttempts) {
    return new MfaApiError(
      "throttled",
      parseRetryAfter(response.headers.get("Retry-After")),
    );
  }
  if (code === apiErrorCodes.invalidMfaChallenge) {
    return new MfaApiError("invalid_challenge");
  }
  if (code === apiErrorCodes.stepUpRequired) {
    return new MfaApiError("denied");
  }
  if (response.status === 401 || response.status === 403) {
    return new MfaApiError("denied");
  }
  if (response.status === 409) return new MfaApiError("conflict");
  if (response.status === 400) return new MfaApiError("validation");
  return new MfaApiError("unavailable");
}

async function readErrorCode(response: Response): Promise<unknown> {
  try {
    const body = (await response.clone().json()) as { error?: { code?: unknown } };
    return body.error?.code;
  } catch {
    return undefined;
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : null;
}
