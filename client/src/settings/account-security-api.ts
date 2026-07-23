import { z } from "zod";
import {
  adminAccountSecurityListResponseSchema,
  adminAccountSecurityParamsSchema,
  resetAdminMfaRequestSchema,
  updateAdminAccountEmailRequestSchema,
  updateAdminCapabilityRequestSchema,
  type AdminAccountSecurityItem,
} from "../../../shared/admin-account-security.js";
import type { ApiClient } from "../api/client.js";

export class AccountSecurityApiError extends Error {
  constructor(readonly kind: "conflict" | "denied" | "invalid_response" | "rejected" | "unavailable") {
    super("Account security request could not be completed");
    this.name = "AccountSecurityApiError";
  }
}

export interface AccountSecurityApi {
  list(): Promise<AdminAccountSecurityItem[]>;
  resetMfa(userId: string, reason: string, stepUpToken: string): Promise<void>;
  setAdminCapability(userId: string, enabled: boolean, stepUpToken: string): Promise<void>;
  setSupportCapability(userId: string, enabled: boolean, stepUpToken: string): Promise<void>;
  updateEmail(userId: string, email: string, stepUpToken: string): Promise<void>;
}

export function createAccountSecurityApi(client: ApiClient): AccountSecurityApi {
  return {
    async list() {
      const response = await request(client, "/admin/account-security", {
        cache: "no-store",
        headers: { Accept: "application/json" },
        method: "GET",
      });
      return (await parse(response, adminAccountSecurityListResponseSchema)).items;
    },
    async resetMfa(userId, reason, stepUpToken) {
      const params = parseInput(adminAccountSecurityParamsSchema, { userId });
      const body = parseInput(resetAdminMfaRequestSchema, { reason });
      await mutate(client, `/admin/account-security/${encodeURIComponent(params.userId)}/mfa-reset`, "POST", body, stepUpToken);
    },
    async setAdminCapability(userId, enabled, stepUpToken) {
      const params = parseInput(adminAccountSecurityParamsSchema, { userId });
      const body = parseInput(updateAdminCapabilityRequestSchema, { enabled });
      await mutate(client, `/admin/account-security/${encodeURIComponent(params.userId)}/admin-capability`, "PATCH", body, stepUpToken);
    },
    async setSupportCapability(userId, enabled, stepUpToken) {
      const params = parseInput(adminAccountSecurityParamsSchema, { userId });
      const body = parseInput(updateAdminCapabilityRequestSchema, { enabled });
      await mutate(client, `/admin/account-security/${encodeURIComponent(params.userId)}/support-capability`, "PATCH", body, stepUpToken);
    },
    async updateEmail(userId, email, stepUpToken) {
      const params = parseInput(adminAccountSecurityParamsSchema, { userId });
      const body = parseInput(updateAdminAccountEmailRequestSchema, { email });
      await mutate(client, `/admin/account-security/${encodeURIComponent(params.userId)}/email`, "PATCH", body, stepUpToken);
    },
  };
}

async function mutate(
  client: ApiClient,
  path: string,
  method: "PATCH" | "POST",
  body: unknown,
  stepUpToken: string,
): Promise<void> {
  const response = await request(client, path, {
    body: JSON.stringify(body),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-WCIB-Step-Up": stepUpToken,
    },
    method,
  });
  if (response.status !== 204) throw await mapFailure(response);
}

async function request(
  client: ApiClient,
  path: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await client.request(path, init);
  } catch {
    throw new AccountSecurityApiError("unavailable");
  }
}

async function parse<Schema extends z.ZodTypeAny>(response: Response, schema: Schema) {
  if (!response.ok) throw await mapFailure(response);
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new AccountSecurityApiError("invalid_response");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new AccountSecurityApiError("invalid_response");
  return parsed.data;
}

function parseInput<Schema extends z.ZodTypeAny>(schema: Schema, value: unknown): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AccountSecurityApiError("rejected");
  return parsed.data;
}

async function mapFailure(response: Response): Promise<AccountSecurityApiError> {
  if (response.status === 401 || response.status === 403) return new AccountSecurityApiError("denied");
  if (response.status === 409 || response.status === 404) return new AccountSecurityApiError("conflict");
  if (response.status === 400) return new AccountSecurityApiError("rejected");
  return new AccountSecurityApiError("unavailable");
}
