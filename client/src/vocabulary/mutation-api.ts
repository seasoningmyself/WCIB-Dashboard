import { z } from "zod";
import { POLICY_TYPE_CLASSES } from "../../../shared/policy-types.js";
import {
  createCarrierRequestSchema,
  createMgaRequestSchema,
  createPolicyTypeRequestSchema,
  type CarrierMutationResponse,
  type CreateCarrierRequest,
  type CreateMgaRequest,
  type CreatePolicyTypeRequest,
  type MgaMutationResponse,
  type PolicyTypeMutationResponse,
} from "../../../shared/vocabulary.js";
import type { ApiClient } from "../api/client.js";

const optionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
});

const carrierResponseSchema = z.union([
  z.object({ item: optionSchema, outcome: z.literal("created") }),
  z.object({ item: optionSchema, outcome: z.literal("duplicate") }),
]);

const policyTypeResponseSchema = z.union([
  z.object({
    item: optionSchema.extend({ classTag: z.enum(POLICY_TYPE_CLASSES) }),
    outcome: z.literal("created"),
  }),
  z.object({
    item: optionSchema.extend({ classTag: z.enum(POLICY_TYPE_CLASSES) }),
    outcome: z.literal("duplicate"),
  }),
]);

const mgaResponseSchema = z.union([
  z.object({ item: optionSchema, outcome: z.literal("created") }),
  z.object({ item: optionSchema, outcome: z.literal("duplicate") }),
  z.object({
    candidates: z.array(optionSchema).min(1),
    outcome: z.literal("confirmation_required"),
  }),
]);

export type VocabularyMutationErrorKind =
  | "forbidden"
  | "invalid_response"
  | "rejected"
  | "unavailable";

export class VocabularyMutationApiError extends Error {
  constructor(readonly kind: VocabularyMutationErrorKind) {
    super("Vocabulary change could not be completed");
    this.name = "VocabularyMutationApiError";
  }
}

export interface VocabularyMutationApi {
  createCarrier(request: CreateCarrierRequest): Promise<CarrierMutationResponse>;
  createMga(request: CreateMgaRequest): Promise<MgaMutationResponse>;
  createPolicyType(
    request: CreatePolicyTypeRequest,
  ): Promise<PolicyTypeMutationResponse>;
}

export function createVocabularyMutationApi(
  client: ApiClient,
): VocabularyMutationApi {
  return {
    async createCarrier(request) {
      return mutateVocabulary(
        client,
        "/vocabulary/carriers",
        parseRequest(createCarrierRequestSchema, request),
        carrierResponseSchema,
      );
    },
    async createMga(request) {
      return mutateVocabulary(
        client,
        "/vocabulary/mgas",
        parseRequest(createMgaRequestSchema, request),
        mgaResponseSchema,
      );
    },
    async createPolicyType(request) {
      return mutateVocabulary(
        client,
        "/vocabulary/policy-types",
        parseRequest(createPolicyTypeRequestSchema, request),
        policyTypeResponseSchema,
      );
    },
  };
}

export interface SingleFlightResult<TResult> {
  result?: TResult;
  started: boolean;
}

export function createSingleFlightRunner(
  onPendingChange: (pending: boolean) => void = () => undefined,
) {
  let pending = false;
  return {
    isPending: () => pending,
    async run<TResult>(
      operation: () => Promise<TResult>,
    ): Promise<SingleFlightResult<TResult>> {
      if (pending) {
        return { started: false };
      }
      pending = true;
      onPendingChange(true);
      try {
        return { result: await operation(), started: true };
      } finally {
        pending = false;
        onPendingChange(false);
      }
    },
  };
}

function parseRequest<TRequest>(
  schema: z.ZodType<TRequest>,
  request: unknown,
): TRequest {
  const parsed = schema.safeParse(request);
  if (!parsed.success) {
    throw new VocabularyMutationApiError("rejected");
  }
  return parsed.data;
}

async function mutateVocabulary<TResponse>(
  client: ApiClient,
  path: string,
  body: unknown,
  schema: z.ZodType<TResponse>,
): Promise<TResponse> {
  let response: Response;
  try {
    response = await client.request(path, {
      body: JSON.stringify(body),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  } catch {
    throw new VocabularyMutationApiError("unavailable");
  }
  if (response.status === 403) {
    throw new VocabularyMutationApiError("forbidden");
  }
  if (response.status === 400) {
    throw new VocabularyMutationApiError("rejected");
  }
  if (response.status !== 201 && response.status !== 409) {
    throw new VocabularyMutationApiError("unavailable");
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new VocabularyMutationApiError("invalid_response");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new VocabularyMutationApiError("invalid_response");
  }
  const outcome = (parsed.data as { outcome: string }).outcome;
  if (
    (response.status === 201 && outcome !== "created") ||
    (response.status === 409 && outcome === "created")
  ) {
    throw new VocabularyMutationApiError("invalid_response");
  }
  return parsed.data;
}
