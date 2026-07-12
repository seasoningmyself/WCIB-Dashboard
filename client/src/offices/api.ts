import { z } from "zod";
import {
  adminOfficeManagementResponseSchema,
  adminOfficeParamsSchema,
  createAdminOfficeRequestSchema,
  renameAdminOfficeRequestSchema,
  type AdminOfficeManagementResponse,
} from "../../../shared/admin-office-locations.js";
import type { ApiClient } from "../api/client.js";

export type AdminOfficeApiErrorKind =
  | "conflict"
  | "denied"
  | "invalid_response"
  | "rejected"
  | "unavailable";

export class AdminOfficeApiError extends Error {
  constructor(readonly kind: AdminOfficeApiErrorKind) {
    super("Office location request could not be completed");
    this.name = "AdminOfficeApiError";
  }
}

export interface AdminOfficeApi {
  create(name: string): Promise<AdminOfficeManagementResponse>;
  list(): Promise<AdminOfficeManagementResponse>;
  rename(officeLocationId: string, name: string): Promise<AdminOfficeManagementResponse>;
  setActive(
    officeLocationId: string,
    active: boolean,
  ): Promise<AdminOfficeManagementResponse>;
}

export function createAdminOfficeApi(client: ApiClient): AdminOfficeApi {
  return {
    async create(name) {
      const input = parseRequest(createAdminOfficeRequestSchema, { name });
      return mutate(client, "/admin/office-locations", "POST", input);
    },
    async list() {
      return read(client, "/admin/office-locations");
    },
    async rename(officeLocationId, name) {
      const params = parseRequest(adminOfficeParamsSchema, { officeLocationId });
      const input = parseRequest(renameAdminOfficeRequestSchema, { name });
      return mutate(
        client,
        `/admin/office-locations/${encodeURIComponent(params.officeLocationId)}`,
        "PATCH",
        input,
      );
    },
    async setActive(officeLocationId, active) {
      const params = parseRequest(adminOfficeParamsSchema, { officeLocationId });
      return mutate(
        client,
        `/admin/office-locations/${encodeURIComponent(params.officeLocationId)}/${active ? "reactivate" : "deactivate"}`,
        "POST",
        {},
      );
    },
  };
}

async function read(
  client: ApiClient,
  path: string,
): Promise<AdminOfficeManagementResponse> {
  let response: Response;
  try {
    response = await client.request(path, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      method: "GET",
    });
  } catch {
    throw new AdminOfficeApiError("unavailable");
  }
  return parseResponse(response);
}

async function mutate(
  client: ApiClient,
  path: string,
  method: "PATCH" | "POST",
  body: unknown,
): Promise<AdminOfficeManagementResponse> {
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
    throw new AdminOfficeApiError("unavailable");
  }
  return parseResponse(response);
}

async function parseResponse(
  response: Response,
): Promise<AdminOfficeManagementResponse> {
  if (response.status !== 200 && response.status !== 201) {
    if (response.status === 401 || response.status === 403) {
      throw new AdminOfficeApiError("denied");
    }
    if (response.status === 404 || response.status === 409) {
      throw new AdminOfficeApiError("conflict");
    }
    if (response.status === 400) {
      throw new AdminOfficeApiError("rejected");
    }
    throw new AdminOfficeApiError("unavailable");
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new AdminOfficeApiError("invalid_response");
  }
  const parsed = adminOfficeManagementResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AdminOfficeApiError("invalid_response");
  }
  return parsed.data;
}

function parseRequest<Schema extends z.ZodTypeAny>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AdminOfficeApiError("rejected");
  }
  return parsed.data;
}
