import {
  currentUserResponseSchema,
  type CurrentUser,
} from "../../../shared/current-user.js";
import {
  loginRequestSchema,
  loginResponseSchema,
  type LoginRequest,
} from "../../../shared/login.js";
import { apiErrorCodes } from "../../../shared/api-errors.js";
import {
  requiredPasswordChangeRequestSchema,
  type RequiredPasswordChangeRequest,
} from "../../../shared/account-settings.js";
import {
  passwordResetConfirmSchema,
  passwordResetRequestResponseSchema,
  passwordResetRequestSchema,
  type PasswordResetConfirm,
  type PasswordResetRequest,
} from "../../../shared/password-reset.js";
import { apiBaseUrl } from "../config.js";

export type AuthApiErrorKind =
  | "invalid_credentials"
  | "invalid_response"
  | "network"
  | "server"
  | "throttled"
  | "validation";

export class AuthApiError extends Error {
  readonly kind: AuthApiErrorKind;

  constructor(
    kind: AuthApiErrorKind,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(authErrorMessage(kind));
    this.name = "AuthApiError";
    this.kind = kind;
  }
}

export interface AuthApi {
  changeRequiredPassword(
    request: RequiredPasswordChangeRequest,
  ): Promise<CurrentUser>;
  confirmPasswordReset(request: PasswordResetConfirm): Promise<void>;
  login(request: LoginRequest): Promise<CurrentUser>;
  logout(): Promise<void>;
  requestPasswordReset(request: PasswordResetRequest): Promise<void>;
  restoreCurrentUser(): Promise<CurrentUser | null>;
}

export type PasswordChangeApiErrorKind =
  | "invalid_response"
  | "network"
  | "reuse"
  | "server"
  | "validation";

export class PasswordChangeApiError extends Error {
  constructor(readonly kind: PasswordChangeApiErrorKind) {
    super("Password could not be changed");
    this.name = "PasswordChangeApiError";
  }
}

export type PasswordResetApiErrorKind =
  | "invalid_response"
  | "invalid_token"
  | "network"
  | "server"
  | "validation";

export class PasswordResetApiError extends Error {
  readonly kind: PasswordResetApiErrorKind;

  constructor(kind: PasswordResetApiErrorKind) {
    super(passwordResetErrorMessage(kind));
    this.name = "PasswordResetApiError";
    this.kind = kind;
  }
}

export type AuthFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function createAuthApi(
  fetchRequest: AuthFetch = globalThis.fetch.bind(globalThis),
  baseUrl = apiBaseUrl,
): AuthApi {
  return {
    async changeRequiredPassword(rawRequest) {
      const request = requiredPasswordChangeRequestSchema.safeParse(rawRequest);
      if (!request.success) {
        throw new PasswordChangeApiError("validation");
      }
      let response: Response;
      try {
        response = await fetchRequest(
          endpoint(baseUrl, "/auth/required-password-change"),
          {
            body: JSON.stringify(request.data),
            credentials: "same-origin",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            method: "POST",
          },
        );
      } catch {
        throw new PasswordChangeApiError("network");
      }
      if (
        response.status === 409 &&
        (await readErrorCode(response)) === apiErrorCodes.passwordReuse
      ) {
        throw new PasswordChangeApiError("reuse");
      }
      if (response.status === 400) {
        throw new PasswordChangeApiError("validation");
      }
      if (response.status !== 204) {
        throw new PasswordChangeApiError("server");
      }
      try {
        const user = await loadCurrentUser(fetchRequest, baseUrl);
        if (user === null) throw new PasswordChangeApiError("invalid_response");
        return user;
      } catch (error) {
        if (error instanceof PasswordChangeApiError) throw error;
        throw new PasswordChangeApiError("invalid_response");
      }
    },

    async confirmPasswordReset(rawRequest) {
      const request = passwordResetConfirmSchema.safeParse(rawRequest);
      if (!request.success) {
        throw new PasswordResetApiError("validation");
      }
      const response = await safePasswordResetFetch(
        fetchRequest,
        endpoint(baseUrl, "/auth/password-reset/confirm"),
        {
          body: JSON.stringify(request.data),
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      );
      if (
        response.status === 400 &&
        (await readErrorCode(response)) === apiErrorCodes.invalidResetToken
      ) {
        throw new PasswordResetApiError("invalid_token");
      }
      if (response.status !== 204) {
        throw new PasswordResetApiError("server");
      }
    },

    async login(rawRequest) {
      const request = loginRequestSchema.safeParse(rawRequest);
      if (!request.success) {
        throw new AuthApiError("validation");
      }

      const loginResponse = await safeFetch(fetchRequest, endpoint(baseUrl, "/auth/login"), {
        body: JSON.stringify(request.data),
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      if (!loginResponse.ok) {
        if (
          loginResponse.status === 429 &&
          (await readErrorCode(loginResponse)) === apiErrorCodes.tooManyAttempts
        ) {
          throw new AuthApiError(
            "throttled",
            parseRetryAfter(loginResponse.headers.get("Retry-After")),
          );
        }
        if (
          loginResponse.status === 401 &&
          (await readErrorCode(loginResponse)) ===
            apiErrorCodes.invalidCredentials
        ) {
          throw new AuthApiError("invalid_credentials");
        }
        throw new AuthApiError("server");
      }

      const loginSummary = loginResponseSchema.safeParse(
        await readJson(loginResponse),
      );
      if (!loginSummary.success) {
        throw new AuthApiError("invalid_response");
      }

      const currentUser = await loadCurrentUser(fetchRequest, baseUrl);
      if (currentUser === null || currentUser.id !== loginSummary.data.user.id) {
        throw new AuthApiError("invalid_response");
      }
      return currentUser;
    },

    async logout() {
      const response = await safeFetch(
        fetchRequest,
        endpoint(baseUrl, "/auth/logout"),
        {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          method: "POST",
        },
      );
      if (response.status !== 204) {
        throw new AuthApiError("server");
      }
    },

    async requestPasswordReset(rawRequest) {
      const request = passwordResetRequestSchema.safeParse(rawRequest);
      if (!request.success) {
        throw new PasswordResetApiError("validation");
      }
      const response = await safePasswordResetFetch(
        fetchRequest,
        endpoint(baseUrl, "/auth/password-reset/request"),
        {
          body: JSON.stringify(request.data),
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      );
      if (response.status !== 202) {
        throw new PasswordResetApiError("server");
      }
      const accepted = passwordResetRequestResponseSchema.safeParse(
        await readPasswordResetJson(response),
      );
      if (!accepted.success) {
        throw new PasswordResetApiError("invalid_response");
      }
    },

    restoreCurrentUser() {
      return loadCurrentUser(fetchRequest, baseUrl);
    },
  };
}

async function safePasswordResetFetch(
  fetchRequest: AuthFetch,
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchRequest(input, init);
  } catch {
    throw new PasswordResetApiError("network");
  }
}

async function readPasswordResetJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new PasswordResetApiError("invalid_response");
  }
}

async function loadCurrentUser(
  fetchRequest: AuthFetch,
  baseUrl: string,
): Promise<CurrentUser | null> {
  const response = await safeFetch(fetchRequest, endpoint(baseUrl, "/me"), {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    method: "GET",
  });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new AuthApiError("server");
  }

  const currentUser = currentUserResponseSchema.safeParse(
    await readJson(response),
  );
  if (!currentUser.success) {
    throw new AuthApiError("invalid_response");
  }
  return currentUser.data.user;
}

async function safeFetch(
  fetchRequest: AuthFetch,
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchRequest(input, init);
  } catch {
    throw new AuthApiError("network");
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new AuthApiError("invalid_response");
  }
}

async function readErrorCode(response: Response): Promise<unknown> {
  const body = await readJson(response).catch(() => null);
  if (body === null || typeof body !== "object") {
    return undefined;
  }
  const error = (body as { error?: unknown }).error;
  if (error === null || typeof error !== "object") {
    return undefined;
  }
  return (error as { code?: unknown }).code;
}

function endpoint(baseUrl: string, suffix: string): string {
  return `${baseUrl}${suffix}`;
}

function authErrorMessage(kind: AuthApiErrorKind): string {
  switch (kind) {
    case "invalid_credentials":
      return "Email or password is incorrect";
    case "network":
      return "WCIB could not be reached";
    case "validation":
      return "Sign-in details are incomplete";
    case "throttled":
      return "Too many sign-in attempts";
    case "invalid_response":
    case "server":
      return "Sign-in is temporarily unavailable";
  }
}

function parseRetryAfter(value: string | null): number {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(15 * 60, Math.ceil(seconds))
    : 60;
}

function passwordResetErrorMessage(
  kind: PasswordResetApiErrorKind,
): string {
  switch (kind) {
    case "invalid_token":
      return "Password reset link is invalid or expired";
    case "network":
      return "WCIB could not be reached";
    case "validation":
      return "Password reset details are invalid";
    case "invalid_response":
    case "server":
      return "Password reset is temporarily unavailable";
  }
}
