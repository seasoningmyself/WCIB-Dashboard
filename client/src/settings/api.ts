import { z } from "zod";
import {
  changeOwnPasswordRequestSchema,
  ownSettingsResponseSchema,
  updateOwnProfileRequestSchema,
  type ChangeOwnPasswordRequest,
  type OwnSettings,
  type UpdateOwnProfileRequest,
} from "../../../shared/account-settings.js";
import { apiErrorCodes } from "../../../shared/api-errors.js";
import type { ApiClient } from "../api/client.js";

export type SettingsApiErrorKind =
  | "conflict"
  | "denied"
  | "invalid_current_password"
  | "invalid_response"
  | "rejected"
  | "reuse"
  | "unavailable";

export class SettingsApiError extends Error {
  constructor(readonly kind: SettingsApiErrorKind) {
    super("Account settings request could not be completed");
    this.name = "SettingsApiError";
  }
}

export interface SettingsApi {
  changePassword(input: ChangeOwnPasswordRequest): Promise<void>;
  load(): Promise<OwnSettings>;
  updateProfile(input: UpdateOwnProfileRequest): Promise<OwnSettings>;
}

export function createSettingsApi(client: ApiClient): SettingsApi {
  return {
    async changePassword(input) {
      const body = parseRequest(changeOwnPasswordRequestSchema, input);
      const response = await request(client, "/settings/me/password", {
        body: JSON.stringify(body),
        headers: jsonHeaders,
        method: "POST",
      });
      if (response.status !== 204) {
        throw await mapFailure(response);
      }
    },
    async load() {
      const response = await request(client, "/settings/me", {
        cache: "no-store",
        headers: { Accept: "application/json" },
        method: "GET",
      });
      return (await parseSettingsResponse(response)).settings;
    },
    async updateProfile(input) {
      const body = parseRequest(updateOwnProfileRequestSchema, input);
      const response = await request(client, "/settings/me/profile", {
        body: JSON.stringify(body),
        headers: jsonHeaders,
        method: "PATCH",
      });
      return (await parseSettingsResponse(response)).settings;
    },
  };
}

const jsonHeaders = {
  Accept: "application/json",
  "Content-Type": "application/json",
};

async function request(
  client: ApiClient,
  path: string,
  options: RequestInit,
): Promise<Response> {
  try {
    return await client.request(path, options);
  } catch {
    throw new SettingsApiError("unavailable");
  }
}

async function parseSettingsResponse(response: Response) {
  if (response.status !== 200) throw await mapFailure(response);
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new SettingsApiError("invalid_response");
  }
  const parsed = ownSettingsResponseSchema.safeParse(raw);
  if (!parsed.success) throw new SettingsApiError("invalid_response");
  return parsed.data;
}

async function mapFailure(response: Response): Promise<SettingsApiError> {
  if (response.status === 401 || response.status === 403) {
    return new SettingsApiError("denied");
  }
  const code = await readErrorCode(response);
  if (code === apiErrorCodes.invalidCurrentPassword) {
    return new SettingsApiError("invalid_current_password");
  }
  if (code === apiErrorCodes.passwordReuse) {
    return new SettingsApiError("reuse");
  }
  if (response.status === 409) return new SettingsApiError("conflict");
  if (response.status === 400) return new SettingsApiError("rejected");
  return new SettingsApiError("unavailable");
}

async function readErrorCode(response: Response): Promise<unknown> {
  try {
    const body = (await response.json()) as {
      error?: { code?: unknown };
    };
    return body.error?.code;
  } catch {
    return undefined;
  }
}

function parseRequest<Schema extends z.ZodTypeAny>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new SettingsApiError("rejected");
  return parsed.data;
}
