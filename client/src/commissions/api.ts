import { z } from "zod";
import {
  myCommissionItemSchema,
  myCommissionReceiptParamsSchema,
  myCommissionReceiptRequestSchema,
  myCommissionsListQuerySchema,
  myCommissionsResponseSchema,
  type MyCommissionItem,
  type MyCommissionReceiptRequest,
  type MyCommissionsListQuery,
  type MyCommissionsResponse,
} from "../../../shared/my-commissions.js";
import type { ApiClient } from "../api/client.js";

export type MyCommissionsApiErrorKind =
  | "conflict"
  | "denied"
  | "invalid_response"
  | "rejected"
  | "unavailable";

export class MyCommissionsApiError extends Error {
  constructor(readonly kind: MyCommissionsApiErrorKind) {
    super("Commission request could not be completed");
    this.name = "MyCommissionsApiError";
  }
}

export interface MyCommissionsApi {
  list(query: MyCommissionsListQuery): Promise<MyCommissionsResponse>;
  setReceipt(
    policyId: string,
    input: MyCommissionReceiptRequest,
  ): Promise<MyCommissionItem>;
}

export function createMyCommissionsApi(client: ApiClient): MyCommissionsApi {
  return {
    async list(input) {
      const query = parseRequest(myCommissionsListQuerySchema, input);
      const parameters = new URLSearchParams({
        search: query.search,
        sort: query.sort,
      });
      return read(
        client,
        `/my-commissions?${parameters.toString()}`,
        myCommissionsResponseSchema,
      );
    },
    async setReceipt(policyId, input) {
      const params = parseRequest(myCommissionReceiptParamsSchema, { policyId });
      const body = parseRequest(myCommissionReceiptRequestSchema, input);
      return mutate(
        client,
        `/my-commissions/${encodeURIComponent(params.policyId)}/receipt`,
        body,
        myCommissionItemSchema,
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
    throw new MyCommissionsApiError("unavailable");
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
    throw new MyCommissionsApiError("unavailable");
  }
  return parseResponse(response, schema);
}

async function parseResponse<Schema extends z.ZodTypeAny>(
  response: Response,
  schema: Schema,
): Promise<z.output<Schema>> {
  if (response.status !== 200) {
    if (response.status === 401 || response.status === 403) {
      throw new MyCommissionsApiError("denied");
    }
    if (response.status === 404 || response.status === 409) {
      throw new MyCommissionsApiError("conflict");
    }
    if (response.status === 400) {
      throw new MyCommissionsApiError("rejected");
    }
    throw new MyCommissionsApiError("unavailable");
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new MyCommissionsApiError("invalid_response");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new MyCommissionsApiError("invalid_response");
  }
  return parsed.data;
}

function parseRequest<Schema extends z.ZodTypeAny>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new MyCommissionsApiError("rejected");
  return parsed.data;
}
