import { z } from "zod";
import {
  adminStaffListResponseSchema,
  adminStaffMutationResponseSchema,
  adminStaffParamsSchema,
  adminStaffRateParamsSchema,
  createAdminStaffRequestSchema,
  producerRateInputSchema,
  updateAdminStaffRequestSchema,
  type AdminStaffRecord,
  type CreateAdminStaffRequest,
  type ProducerRateInput,
  type UpdateAdminStaffRequest,
} from "../../../shared/admin-staff.js";
import type { ApiClient } from "../api/client.js";

export type AdminStaffApiErrorKind =
  | "conflict"
  | "denied"
  | "invalid_response"
  | "rejected"
  | "unavailable";

export class AdminStaffApiError extends Error {
  constructor(readonly kind: AdminStaffApiErrorKind) {
    super("Staff request could not be completed");
    this.name = "AdminStaffApiError";
  }
}

export interface AdminStaffApi {
  create(input: CreateAdminStaffRequest): Promise<AdminStaffRecord>;
  createRate(userId: string, input: ProducerRateInput): Promise<AdminStaffRecord>;
  list(): Promise<readonly AdminStaffRecord[]>;
  setActive(userId: string, active: boolean): Promise<AdminStaffRecord>;
  update(userId: string, input: UpdateAdminStaffRequest): Promise<AdminStaffRecord>;
  updateRate(
    userId: string,
    rateId: string,
    input: ProducerRateInput,
  ): Promise<AdminStaffRecord>;
}

export function createAdminStaffApi(client: ApiClient): AdminStaffApi {
  return {
    async create(input) {
      const body = parseRequest(createAdminStaffRequestSchema, input);
      return (await mutate(client, "/admin/staff", "POST", body)).staff;
    },
    async createRate(userId, input) {
      const params = parseRequest(adminStaffParamsSchema, { userId });
      const body = parseRequest(producerRateInputSchema, input);
      return (
        await mutate(
          client,
          `/admin/staff/${encodeURIComponent(params.userId)}/rates`,
          "POST",
          body,
        )
      ).staff;
    },
    async list() {
      const response = await read(client, "/admin/staff");
      return response.items;
    },
    async setActive(userId, active) {
      const params = parseRequest(adminStaffParamsSchema, { userId });
      const action = active ? "reactivate" : "deactivate";
      return (
        await mutate(
          client,
          `/admin/staff/${encodeURIComponent(params.userId)}/${action}`,
          "POST",
          {},
        )
      ).staff;
    },
    async update(userId, input) {
      const params = parseRequest(adminStaffParamsSchema, { userId });
      const body = parseRequest(updateAdminStaffRequestSchema, input);
      return (
        await mutate(
          client,
          `/admin/staff/${encodeURIComponent(params.userId)}`,
          "PATCH",
          body,
        )
      ).staff;
    },
    async updateRate(userId, rateId, input) {
      const params = parseRequest(adminStaffRateParamsSchema, { rateId, userId });
      const body = parseRequest(producerRateInputSchema, input);
      return (
        await mutate(
          client,
          `/admin/staff/${encodeURIComponent(params.userId)}/rates/${encodeURIComponent(params.rateId)}`,
          "PATCH",
          body,
        )
      ).staff;
    },
  };
}

async function read(client: ApiClient, path: string) {
  let response: Response;
  try {
    response = await client.request(path, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      method: "GET",
    });
  } catch {
    throw new AdminStaffApiError("unavailable");
  }
  return parseResponse(response, adminStaffListResponseSchema);
}

async function mutate(
  client: ApiClient,
  path: string,
  method: "PATCH" | "POST",
  body: unknown,
) {
  let response: Response;
  try {
    response = await client.request(path, {
      body: JSON.stringify(body),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method,
    });
  } catch {
    throw new AdminStaffApiError("unavailable");
  }
  return parseResponse(response, adminStaffMutationResponseSchema);
}

async function parseResponse<Schema extends z.ZodTypeAny>(
  response: Response,
  schema: Schema,
): Promise<z.output<Schema>> {
  if (response.status !== 200 && response.status !== 201) {
    if (response.status === 401 || response.status === 403) {
      throw new AdminStaffApiError("denied");
    }
    if (response.status === 404 || response.status === 409) {
      throw new AdminStaffApiError("conflict");
    }
    if (response.status === 400) {
      throw new AdminStaffApiError("rejected");
    }
    throw new AdminStaffApiError("unavailable");
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new AdminStaffApiError("invalid_response");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AdminStaffApiError("invalid_response");
  }
  return parsed.data;
}

function parseRequest<Schema extends z.ZodTypeAny>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AdminStaffApiError("rejected");
  }
  return parsed.data;
}
