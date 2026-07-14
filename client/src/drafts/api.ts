import { z } from "zod";
import {
  createDraftRequestSchema,
  createDraftResponseSchema,
  editDraftResponseSchema,
  flagDraftRequestSchema,
  flagDraftResponseSchema,
  listDraftsQuerySchema,
  listDraftsResponseSchema,
  submitDraftResponseSchema,
  updateDraftRequestSchema,
  withdrawFlaggedDraftRequestSchema,
  withdrawFlaggedDraftResponseSchema,
  withdrawSubmittedDraftRequestSchema,
  withdrawSubmittedDraftResponseSchema,
  type CreateDraftRequest,
  type CreateDraftResponse,
  type FlagDraftRequest,
  type ListDraftsQuery,
  type ListDraftsResponse,
  type SubmitDraftResponse,
  type UpdateDraftRequest,
  type WithdrawFlaggedDraftResponse,
  type WithdrawSubmittedDraftResponse,
} from "../../../shared/drafts.js";
import {
  draftAssignmentOptionsResponseSchema,
  type DraftAssignmentOptionsResponse,
} from "../../../shared/draft-assignment-options.js";
import type { ApiClient } from "../api/client.js";

const safeApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    details: z
      .array(z.object({ field: z.string(), message: z.string() }))
      .optional(),
    message: z.string(),
  }),
});

export type DraftApiErrorKind =
  | "conflict"
  | "invalid_response"
  | "rejected"
  | "unavailable";

export class DraftApiError extends Error {
  constructor(
    readonly kind: DraftApiErrorKind,
    readonly details: readonly { field: string; message: string }[] = [],
  ) {
    super("Draft request could not be completed");
    this.name = "DraftApiError";
  }
}

export interface DraftApi {
  create(input: CreateDraftRequest): Promise<CreateDraftResponse>;
  edit(draftId: string, input: UpdateDraftRequest): Promise<CreateDraftResponse>;
  flag(draftId: string, input: FlagDraftRequest): Promise<CreateDraftResponse>;
  list(query?: ListDraftsQuery): Promise<ListDraftsResponse>;
  listAssignmentOptions(): Promise<DraftAssignmentOptionsResponse>;
  submit(draftId: string): Promise<SubmitDraftResponse>;
  withdrawHelp(draftId: string): Promise<WithdrawFlaggedDraftResponse>;
  withdrawSubmission(draftId: string): Promise<WithdrawSubmittedDraftResponse>;
}

export function createDraftApi(client: ApiClient): DraftApi {
  return {
    async create(input) {
      return mutate(
        client,
        "/drafts",
        "POST",
        parseRequest(createDraftRequestSchema, input),
        201,
        createDraftResponseSchema,
      );
    },
    async edit(draftId, input) {
      return mutate(
        client,
        `/drafts/${encodeURIComponent(draftId)}`,
        "PATCH",
        parseRequest(updateDraftRequestSchema, input),
        200,
        editDraftResponseSchema,
      );
    },
    async flag(draftId, input) {
      return mutate(
        client,
        `/drafts/${encodeURIComponent(draftId)}/flag`,
        "POST",
        parseRequest(flagDraftRequestSchema, input),
        200,
        flagDraftResponseSchema,
      );
    },
    async list(query = {}) {
      const normalized = parseRequest(listDraftsQuerySchema, query);
      const params = new URLSearchParams();
      if (normalized.status !== undefined) {
        params.set("status", normalized.status);
      }
      const suffix = params.size === 0 ? "" : `?${params.toString()}`;
      return read(client, `/drafts${suffix}`, listDraftsResponseSchema);
    },
    listAssignmentOptions: () =>
      read(
        client,
        "/draft-assignment-options",
        draftAssignmentOptionsResponseSchema,
      ),
    submit: (draftId) =>
      mutate(
        client,
        `/drafts/${encodeURIComponent(draftId)}/submit`,
        "POST",
        {},
        200,
        submitDraftResponseSchema,
      ),
    withdrawHelp: (draftId) =>
      mutate(
        client,
        `/drafts/${encodeURIComponent(draftId)}/withdraw-help`,
        "POST",
        parseRequest(withdrawFlaggedDraftRequestSchema, {}),
        200,
        withdrawFlaggedDraftResponseSchema,
      ),
    withdrawSubmission: (draftId) =>
      mutate(
        client,
        `/drafts/${encodeURIComponent(draftId)}/withdraw-submission`,
        "POST",
        parseRequest(withdrawSubmittedDraftRequestSchema, {}),
        200,
        withdrawSubmittedDraftResponseSchema,
      ),
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
    throw new DraftApiError("unavailable");
  }
  return parseResponse(response, 200, schema);
}

async function mutate<Schema extends z.ZodTypeAny>(
  client: ApiClient,
  path: string,
  method: "PATCH" | "POST",
  body: unknown,
  expectedStatus: number,
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
      method,
    });
  } catch {
    throw new DraftApiError("unavailable");
  }
  return parseResponse(response, expectedStatus, schema);
}

async function parseResponse<Schema extends z.ZodTypeAny>(
  response: Response,
  expectedStatus: number,
  schema: Schema,
): Promise<z.output<Schema>> {
  if (response.status !== expectedStatus) {
    const error = await parseSafeError(response);
    if (response.status === 400) {
      throw new DraftApiError("rejected", error?.error.details ?? []);
    }
    if (response.status === 404 || response.status === 409) {
      throw new DraftApiError("conflict");
    }
    throw new DraftApiError("unavailable");
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new DraftApiError("invalid_response");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new DraftApiError("invalid_response");
  }
  return parsed.data;
}

async function parseSafeError(response: Response) {
  try {
    return safeApiErrorSchema.safeParse(await response.json()).data ?? null;
  } catch {
    return null;
  }
}

function parseRequest<Schema extends z.ZodTypeAny>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }
  throw new DraftApiError(
    "rejected",
    parsed.error.issues.map((issue) => ({
      field: issue.path.join(".") || "form",
      message: "Check this field.",
    })),
  );
}
