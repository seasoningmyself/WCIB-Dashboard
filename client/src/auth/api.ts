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
import { apiBaseUrl } from "../config.js";

export type AuthApiErrorKind =
  | "invalid_credentials"
  | "invalid_response"
  | "network"
  | "server"
  | "validation";

export class AuthApiError extends Error {
  readonly kind: AuthApiErrorKind;

  constructor(kind: AuthApiErrorKind) {
    super(authErrorMessage(kind));
    this.name = "AuthApiError";
    this.kind = kind;
  }
}

export interface AuthApi {
  login(request: LoginRequest): Promise<CurrentUser>;
  logout(): Promise<void>;
  restoreCurrentUser(): Promise<CurrentUser | null>;
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

    restoreCurrentUser() {
      return loadCurrentUser(fetchRequest, baseUrl);
    },
  };
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
    case "invalid_response":
    case "server":
      return "Sign-in is temporarily unavailable";
  }
}
