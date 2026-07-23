import { z } from "zod";
import {
  adminAccountSecurityParamsSchema,
  resetAdminMfaRequestSchema,
} from "../../../shared/admin-account-security.js";
import {
  operationalSupportDashboardSchema,
  supportDashboardQuerySchema,
  type OperationalSupportDashboard,
  type SupportDashboardQuery,
} from "../../../shared/support-dashboard.js";
import {
  supportAccountSecurityListResponseSchema,
  type SupportAccountSecurityItem,
} from "../../../shared/support-account-security.js";
import type { ApiClient } from "../api/client.js";

export type SupportApiErrorKind =
  | "conflict"
  | "denied"
  | "invalid_response"
  | "rejected"
  | "unavailable";

export class SupportApiError extends Error {
  constructor(readonly kind: SupportApiErrorKind) {
    super("Support request could not be completed");
    this.name = "SupportApiError";
  }
}

export interface SupportApi {
  listAccounts(): Promise<SupportAccountSecurityItem[]>;
  loadDashboard(query: SupportDashboardQuery): Promise<OperationalSupportDashboard>;
  resetMfa(userId: string, reason: string, stepUpToken: string): Promise<void>;
}

export function createSupportApi(client: ApiClient): SupportApi {
  return {
    async listAccounts() {
      const response = await request(client, "/support/accounts", {
        cache: "no-store",
        headers: { Accept: "application/json" },
        method: "GET",
      });
      return (await parse(response, supportAccountSecurityListResponseSchema)).items;
    },
    async loadDashboard(rawQuery) {
      const query = parseInput(supportDashboardQuerySchema, rawQuery);
      const params = new URLSearchParams();
      if (query.period !== undefined) params.set("period", query.period);
      if (query.year !== undefined) params.set("year", String(query.year));
      const suffix = params.size === 0 ? "" : `?${params.toString()}`;
      const response = await request(client, `/support/dashboard${suffix}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        method: "GET",
      });
      return parse(response, operationalSupportDashboardSchema);
    },
    async resetMfa(userId, reason, stepUpToken) {
      const params = parseInput(adminAccountSecurityParamsSchema, { userId });
      const body = parseInput(resetAdminMfaRequestSchema, { reason });
      const response = await request(
        client,
        `/support/accounts/${encodeURIComponent(params.userId)}/mfa-reset`,
        {
          body: JSON.stringify(body),
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-WCIB-Step-Up": stepUpToken,
          },
          method: "POST",
        },
      );
      if (response.status !== 204) throw await mapFailure(response);
    },
  };
}

async function request(
  client: ApiClient,
  path: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await client.request(path, init);
  } catch {
    throw new SupportApiError("unavailable");
  }
}

async function parse<Schema extends z.ZodTypeAny>(
  response: Response,
  schema: Schema,
): Promise<z.output<Schema>> {
  if (!response.ok) throw await mapFailure(response);
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new SupportApiError("invalid_response");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new SupportApiError("invalid_response");
  return parsed.data;
}

function parseInput<Schema extends z.ZodTypeAny>(
  schema: Schema,
  value: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new SupportApiError("rejected");
  return parsed.data;
}

async function mapFailure(response: Response): Promise<SupportApiError> {
  if (response.status === 401 || response.status === 403) {
    return new SupportApiError("denied");
  }
  if (response.status === 404 || response.status === 409) {
    return new SupportApiError("conflict");
  }
  if (response.status === 400) return new SupportApiError("rejected");
  return new SupportApiError("unavailable");
}
