import { z } from "zod";
import { POLICY_TYPE_CLASSES } from "../../../shared/policy-types.js";
import type { ActiveVocabularyResponse } from "../../../shared/vocabulary.js";
import type { ApiClient } from "../api/client.js";

const optionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
});

const activeVocabularyClientSchema = z.object({
  carriers: z.array(optionSchema),
  mgas: z.array(optionSchema),
  officeLocations: z.array(optionSchema),
  policyTypes: z.array(
    optionSchema.extend({ classTag: z.enum(POLICY_TYPE_CLASSES) }),
  ),
});

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
  const parsed = activeVocabularyClientSchema.safeParse(body);
  if (!parsed.success) {
    throw new VocabularyApiError();
  }
  return parsed.data;
}
