import { z } from "zod";
import {
  kpiActualQuerySchema,
  kpiActualResponseSchema,
  type KpiActualQuery,
  type KpiActualResponse,
} from "../../../shared/kpi-actuals.js";
import {
  kpiRecentActivityResponseSchema,
  type KpiRecentActivityResponse,
} from "../../../shared/kpi-activity.js";
import {
  kpiTargetListQuerySchema,
  kpiTargetListResponseSchema,
  kpiTargetMutationRequestSchema,
  kpiTargetMutationResponseSchema,
  kpiTargetParamsSchema,
  type KpiTargetListResponse,
  type KpiTargetMutationRequest,
  type KpiTargetMutationResponse,
} from "../../../shared/kpi-target-api.js";
import type { ApiClient } from "../api/client.js";

export type KpiApiErrorKind =
  | "conflict"
  | "denied"
  | "invalid_response"
  | "rejected"
  | "unavailable";

export class KpiApiError extends Error {
  constructor(readonly kind: KpiApiErrorKind) {
    super("KPI request could not be completed");
    this.name = "KpiApiError";
  }
}

export interface KpiApi {
  loadActuals(query: KpiActualQuery): Promise<KpiActualResponse>;
  loadRecentActivity(): Promise<KpiRecentActivityResponse>;
  loadTargets(year: number): Promise<KpiTargetListResponse>;
  saveTarget(
    scopeType: "company" | "producer",
    year: number,
    input: KpiTargetMutationRequest,
  ): Promise<KpiTargetMutationResponse>;
}

export function createKpiApi(client: ApiClient): KpiApi {
  return {
    async loadActuals(input) {
      const query = parseRequest(kpiActualQuerySchema, input);
      const params = new URLSearchParams();
      params.set("period", query.period);
      if (query.producerUserId !== undefined) {
        params.set("producerUserId", query.producerUserId);
      }
      params.set("scopeType", query.scopeType);
      params.set("year", String(query.year));
      return read(client, `/kpi-actuals?${params.toString()}`, kpiActualResponseSchema);
    },
    async loadRecentActivity() {
      return read(client, "/kpi-activity", kpiRecentActivityResponseSchema);
    },
    async loadTargets(year) {
      const query = parseRequest(kpiTargetListQuerySchema, { year });
      return read(
        client,
        `/kpi-targets?year=${encodeURIComponent(String(query.year))}`,
        kpiTargetListResponseSchema,
      );
    },
    async saveTarget(scopeType, year, input) {
      const params = parseRequest(kpiTargetParamsSchema, { scopeType, year });
      const body = parseRequest(kpiTargetMutationRequestSchema, input);
      return mutate(
        client,
        `/kpi-targets/${encodeURIComponent(params.scopeType)}/${encodeURIComponent(String(params.year))}`,
        body,
        kpiTargetMutationResponseSchema,
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
    throw new KpiApiError("unavailable");
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
    throw new KpiApiError("unavailable");
  }
  return parseResponse(response, schema);
}

async function parseResponse<Schema extends z.ZodTypeAny>(
  response: Response,
  schema: Schema,
): Promise<z.output<Schema>> {
  if (response.status !== 200) {
    if (response.status === 401 || response.status === 403) {
      throw new KpiApiError("denied");
    }
    if (response.status === 404 || response.status === 409) {
      throw new KpiApiError("conflict");
    }
    if (response.status === 400) {
      throw new KpiApiError("rejected");
    }
    throw new KpiApiError("unavailable");
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new KpiApiError("invalid_response");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new KpiApiError("invalid_response");
  return parsed.data;
}

function parseRequest<Schema extends z.ZodTypeAny>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new KpiApiError("rejected");
  return parsed.data;
}
