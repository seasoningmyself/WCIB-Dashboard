import {
  activeVocabularyResponseSchema,
  type ActiveVocabularyResponse,
} from "../../../shared/vocabulary.js";
import type { ApiClient } from "../api/client.js";

export class VocabularyApiError extends Error {
  constructor() {
    super("Vocabulary is unavailable");
    this.name = "VocabularyApiError";
  }
}

export async function loadActiveVocabulary(
  client: ApiClient,
): Promise<ActiveVocabularyResponse> {
  let response: Response;
  try {
    response = await client.request("/vocabulary", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      method: "GET",
    });
  } catch {
    throw new VocabularyApiError();
  }
  if (!response.ok) {
    throw new VocabularyApiError();
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new VocabularyApiError();
  }
  const parsed = activeVocabularyResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new VocabularyApiError();
  }
  return parsed.data;
}
