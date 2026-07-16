import { z } from "zod";
import {
  mgaPayableListQuerySchema,
  mgaPayableListResponseSchema,
  mgaPayableGroupStateRequestSchema,
  mgaPayableGroupStateResponseSchema,
  mgaPayableStateRequestSchema,
  mgaPayableStateResponseSchema,
  type MgaPayableFilter,
  type MgaPayableGroupStateRequest,
  type MgaPayableGroupStateResponse,
  type MgaPayableListResponse,
  type MgaPayableStateRequest,
  type MgaPayableStateResponse,
} from "../../../shared/mga-payables.js";
import type { ApiClient } from "../api/client.js";

export type MgaPayablesApiErrorKind =
  | "conflict"
  | "denied"
  | "invalid_response"
  | "rejected"
  | "unavailable";

export class MgaPayablesApiError extends Error {
  constructor(readonly kind: MgaPayablesApiErrorKind) {
    super("MGA payable request could not be completed");
    this.name = "MgaPayablesApiError";
  }
}

export interface MgaPayablesApi {
  change(
    policyId: string,
    input: MgaPayableStateRequest,
  ): Promise<MgaPayableStateResponse>;
  changeGroup(
    mgaId: string,
    input: MgaPayableGroupStateRequest,
  ): Promise<MgaPayableGroupStateResponse>;
  list(status: MgaPayableFilter): Promise<MgaPayableListResponse>;
}

export function createMgaPayablesApi(client: ApiClient): MgaPayablesApi {
  return {
    async change(policyId, input) {
      const normalized = parseRequest(mgaPayableStateRequestSchema, input);
      return mutate(
        client,
        `/mga-payables/${encodeURIComponent(policyId)}/state`,
        normalized,
        mgaPayableStateResponseSchema,
      );
    },
    async changeGroup(mgaId, input) {
      const normalized = parseRequest(
        mgaPayableGroupStateRequestSchema,
        input,
      );
      return mutate(
        client,
        `/mga-payables/groups/${encodeURIComponent(mgaId)}/state`,
        normalized,
        mgaPayableGroupStateResponseSchema,
      );
    },
    async list(status) {
      const normalized = parseRequest(mgaPayableListQuerySchema, { status });
      const params = new URLSearchParams({ status: normalized.status });
      return read(
        client,
        `/mga-payables?${params.toString()}`,
        mgaPayableListResponseSchema,
      );
    },
  };
}

async function read<Schema extends z.ZodTypeAny>(
  client: ApiClient,
  path: string,
  schema: Schema,
): Promise<z.output<Schema>> {
  let response: Response;
  try {
    response = await client.request(path, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      method: "GET",
    });
  } catch {
    throw new MgaPayablesApiError("unavailable");
  }
  return parseResponse(response, schema);
}

async function mutate<Schema extends z.ZodTypeAny>(
  client: ApiClient,
  path: string,
  body: unknown,
  schema: Schema,
): Promise<z.output<Schema>> {
  let response: Response;
  try {
    response = await client.request(path, {
      body: JSON.stringify(body),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "PUT",
    });
  } catch {
    throw new MgaPayablesApiError("unavailable");
  }
  return parseResponse(response, schema);
}

async function parseResponse<Schema extends z.ZodTypeAny>(
  response: Response,
  schema: Schema,
): Promise<z.output<Schema>> {
  if (response.status !== 200) {
    if (response.status === 401 || response.status === 403) {
      throw new MgaPayablesApiError("denied");
    }
    if (response.status === 404 || response.status === 409) {
      throw new MgaPayablesApiError("conflict");
    }
    if (response.status === 400) {
      throw new MgaPayablesApiError("rejected");
    }
    throw new MgaPayablesApiError("unavailable");
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new MgaPayablesApiError("invalid_response");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new MgaPayablesApiError("invalid_response");
  }
  return parsed.data;
}

function parseRequest<Schema extends z.ZodTypeAny>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new MgaPayablesApiError("rejected");
  }
  return parsed.data;
}
