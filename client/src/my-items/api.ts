import {
  myItemsResponseSchema,
  type MyItemsResponse,
} from "../../../shared/my-items.js";
import type { ApiClient } from "../api/client.js";

export type MyItemsApiErrorKind =
  | "denied"
  | "invalid_response"
  | "unavailable";

export class MyItemsApiError extends Error {
  constructor(readonly kind: MyItemsApiErrorKind) {
    super("My Items request could not be completed");
    this.name = "MyItemsApiError";
  }
}

export interface MyItemsApi {
  list(): Promise<MyItemsResponse>;
}

export function createMyItemsApi(client: ApiClient): MyItemsApi {
  return {
    async list() {
      let response: Response;
      try {
        response = await client.request("/my-items", {
          cache: "no-store",
          headers: { Accept: "application/json" },
          method: "GET",
        });
      } catch {
        throw new MyItemsApiError("unavailable");
      }
      if (response.status === 401 || response.status === 403) {
        throw new MyItemsApiError("denied");
      }
      if (response.status !== 200) {
        throw new MyItemsApiError("unavailable");
      }
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        throw new MyItemsApiError("invalid_response");
      }
      const parsed = myItemsResponseSchema.safeParse(raw);
      if (!parsed.success) {
        throw new MyItemsApiError("invalid_response");
      }
      return parsed.data;
    },
  };
}
