import { z } from "zod";
import {
  businessStateListResponseSchema,
  businessStateTransitionResponseSchema,
  resetBusinessStateRequestSchema,
  restoreBusinessStateRequestSchema,
  type BusinessStateListResponse,
  type BusinessStateTransitionResponse,
  type ResetBusinessStateRequest,
  type RestoreBusinessStateRequest,
} from "../../../shared/business-state.js";
import type { ApiClient } from "../api/client.js";

export type BusinessStateApiErrorKind =
  | "conflict"
  | "denied"
  | "invalid_response"
  | "rejected"
  | "unavailable";

export class BusinessStateApiError extends Error {
  constructor(readonly kind: BusinessStateApiErrorKind) {
    super("Business-state request could not be completed");
    this.name = "BusinessStateApiError";
  }
}

export interface BusinessStateApi {
  list(): Promise<BusinessStateListResponse>;
  reset(input: ResetBusinessStateRequest): Promise<BusinessStateTransitionResponse>;
  restore(
    generationId: string,
    input: RestoreBusinessStateRequest,
  ): Promise<BusinessStateTransitionResponse>;
}

export function createBusinessStateApi(client: ApiClient): BusinessStateApi {
  return {
    list: () => request(client, "/admin/business-state", "GET", undefined, businessStateListResponseSchema),
    reset: (input) =>
      request(
        client,
        "/admin/business-state/reset",
        "POST",
        resetBusinessStateRequestSchema.parse(input),
        businessStateTransitionResponseSchema,
      ),
    restore: (generationId, input) =>
      request(
        client,
        `/admin/business-state/generations/${encodeURIComponent(generationId)}/restore`,
        "POST",
        restoreBusinessStateRequestSchema.parse(input),
        businessStateTransitionResponseSchema,
      ),
  };
}

async function request<Schema extends z.ZodTypeAny>(
  client: ApiClient,
  path: string,
  method: "GET" | "POST",
  body: unknown,
  schema: Schema,
): Promise<z.output<Schema>> {
  let response: Response;
  try {
    response = await client.request(path, {
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      headers:
        body === undefined
          ? { Accept: "application/json" }
          : { Accept: "application/json", "Content-Type": "application/json" },
      method,
    });
  } catch {
    throw new BusinessStateApiError("unavailable");
  }
  if (response.status !== 200) {
    if (response.status === 401 || response.status === 403) {
      throw new BusinessStateApiError("denied");
    }
    if (response.status === 409 || response.status === 404) {
      throw new BusinessStateApiError("conflict");
    }
    if (response.status === 400) {
      throw new BusinessStateApiError("rejected");
    }
    throw new BusinessStateApiError("unavailable");
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new BusinessStateApiError("invalid_response");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new BusinessStateApiError("invalid_response");
  return parsed.data;
}
