import { z } from "zod";
import type { ApiClient } from "../api/client.js";
import {
  adminVocabularyManagementResponseSchema,
  adminVocabularyStateRequestSchema,
  type AdminVocabularyKind,
  type AdminVocabularyManagementResponse,
  type AdminVocabularyStateRequest,
} from "../../../shared/vocabulary.js";

export type AdminVocabularyApiErrorKind =
  | "conflict"
  | "denied"
  | "invalid_response"
  | "rejected"
  | "unavailable";

export class AdminVocabularyApiError extends Error {
  constructor(readonly kind: AdminVocabularyApiErrorKind) {
    super("Vocabulary management request failed");
    this.name = "AdminVocabularyApiError";
  }
}

export interface AdminVocabularyApi {
  list(): Promise<AdminVocabularyManagementResponse>;
  setActive(
    kind: AdminVocabularyKind,
    itemId: string,
    request: AdminVocabularyStateRequest,
  ): Promise<AdminVocabularyManagementResponse>;
}

export function createAdminVocabularyApi(
  client: ApiClient,
): AdminVocabularyApi {
  return {
    async list() {
      return request(client, "/admin/vocabulary", { method: "GET" });
    },
    async setActive(kind, itemId, input) {
      const body = adminVocabularyStateRequestSchema.parse(input);
      return request(
        client,
        `/admin/vocabulary/${kind}/${itemId}/state`,
        {
          body: JSON.stringify(body),
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          method: "PUT",
        },
      );
    },
  };
}

async function request(
  client: ApiClient,
  path: string,
  init: RequestInit,
): Promise<AdminVocabularyManagementResponse> {
  let response: Response;
  try {
    response = await client.request(path, init);
  } catch {
    throw new AdminVocabularyApiError("unavailable");
  }
  if (response.status === 401 || response.status === 403) {
    throw new AdminVocabularyApiError("denied");
  }
  if (response.status === 409) {
    throw new AdminVocabularyApiError("conflict");
  }
  if (response.status === 400 || response.status === 404) {
    throw new AdminVocabularyApiError("rejected");
  }
  if (response.status !== 200) {
    throw new AdminVocabularyApiError("unavailable");
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new AdminVocabularyApiError("invalid_response");
  }
  return parseResponse(adminVocabularyManagementResponseSchema, raw);
}

function parseResponse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AdminVocabularyApiError("invalid_response");
  }
  return parsed.data;
}
