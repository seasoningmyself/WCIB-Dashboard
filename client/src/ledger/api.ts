import { z } from "zod";
import {
  draftAssignmentOptionsResponseSchema,
  type DraftAssignmentOptionsResponse,
} from "../../../shared/draft-assignment-options.js";
import {
  deletedPolicyListResponseSchema,
  policyRestoreRequestSchema,
  policyRestoreResponseSchema,
  policySoftDeleteRequestSchema,
  policySoftDeleteResponseSchema,
  type DeletedPolicyListResponse,
  type PolicyRestoreRequest,
  type PolicyRestoreResponse,
  type PolicySoftDeleteRequest,
  type PolicySoftDeleteResponse,
} from "../../../shared/policy-deletions.js";
import {
  policyLedgerCorrectionRequestSchema,
  policyLedgerCorrectionResponseSchema,
  type PolicyLedgerCorrectionRequest,
} from "../../../shared/policy-corrections.js";
import {
  ipfsPushedStateRequestSchema,
  ipfsPushedStateResponseSchema,
  type IpfsPushedStateRequest,
  type IpfsPushedStateResponse,
} from "../../../shared/ipfs.js";
import {
  policyLedgerDetailResponseSchema,
  policyLedgerListQuerySchema,
  policyLedgerListResponseSchema,
  type PolicyLedgerDetailResponse,
  type PolicyLedgerListQuery,
  type PolicyLedgerListResponse,
} from "../../../shared/policy-ledger.js";
import type { ApiClient } from "../api/client.js";

export type PolicyLedgerApiErrorKind =
  | "conflict"
  | "denied"
  | "invalid_response"
  | "rejected"
  | "unavailable";

export class PolicyLedgerApiError extends Error {
  constructor(readonly kind: PolicyLedgerApiErrorKind) {
    super("Policy ledger request could not be completed");
    this.name = "PolicyLedgerApiError";
  }
}

export interface PolicyLedgerApi {
  correct(
    policyId: string,
    input: PolicyLedgerCorrectionRequest,
  ): Promise<PolicyLedgerCorrectionRequest["kind"]>;
  get(policyId: string): Promise<PolicyLedgerDetailResponse>;
  list(query: Partial<PolicyLedgerListQuery>): Promise<PolicyLedgerListResponse>;
  listAssignmentOptions(): Promise<DraftAssignmentOptionsResponse>;
  listDeleted(): Promise<DeletedPolicyListResponse>;
  downloadIpfsWorkQueue(): Promise<IpfsWorkQueueDocument>;
  setIpfsPushed(
    policyId: string,
    input: IpfsPushedStateRequest,
  ): Promise<IpfsPushedStateResponse>;
  restore(
    policyId: string,
    input: PolicyRestoreRequest,
  ): Promise<PolicyRestoreResponse>;
  softDelete(
    policyId: string,
    input: PolicySoftDeleteRequest,
  ): Promise<PolicySoftDeleteResponse>;
}

export interface IpfsWorkQueueDocument {
  blob: Blob;
  filename: string;
}

export function createPolicyLedgerApi(client: ApiClient): PolicyLedgerApi {
  return {
    async correct(policyId, input) {
      const normalized = parseRequest(policyLedgerCorrectionRequestSchema, input);
      await mutate(
        client,
        `/policies/${encodeURIComponent(policyId)}/correction`,
        normalized,
        policyLedgerCorrectionResponseSchema,
      );
      return normalized.kind;
    },
    get: (policyId) =>
      read(
        client,
        `/policies/${encodeURIComponent(policyId)}`,
        policyLedgerDetailResponseSchema,
      ),
    async list(query) {
      const normalized = parseRequest(policyLedgerListQuerySchema, query);
      const params = new URLSearchParams();
      params.set("duplicates", normalized.duplicates);
      params.set("finance", normalized.finance);
      params.set("limit", String(normalized.limit));
      params.set("offset", String(normalized.offset));
      params.set("search", normalized.search);
      params.set("sort", normalized.sort);
      if (normalized.direction !== undefined) {
        params.set("direction", normalized.direction);
      }
      if (normalized.month !== undefined) {
        params.set("month", normalized.month);
      }
      return read(
        client,
        `/policies?${params.toString()}`,
        policyLedgerListResponseSchema,
      );
    },
    listAssignmentOptions: () =>
      read(
        client,
        "/draft-assignment-options",
        draftAssignmentOptionsResponseSchema,
      ),
    listDeleted: () =>
      read(client, "/deleted-policies", deletedPolicyListResponseSchema),
    downloadIpfsWorkQueue: () => readIpfsWorkQueue(client),
    async setIpfsPushed(policyId, input) {
      return mutate(
        client,
        `/policies/${encodeURIComponent(policyId)}/ipfs-pushed`,
        parseRequest(ipfsPushedStateRequestSchema, input),
        ipfsPushedStateResponseSchema,
      );
    },
    restore: (policyId, input) =>
      mutate(
        client,
        `/deleted-policies/${encodeURIComponent(policyId)}/restore`,
        parseRequest(policyRestoreRequestSchema, input),
        policyRestoreResponseSchema,
        "POST",
      ),
    softDelete: (policyId, input) =>
      mutate(
        client,
        `/policies/${encodeURIComponent(policyId)}/soft-delete`,
        parseRequest(policySoftDeleteRequestSchema, input),
        policySoftDeleteResponseSchema,
        "POST",
      ),
  };
}

async function readIpfsWorkQueue(
  client: ApiClient,
): Promise<IpfsWorkQueueDocument> {
  let response: Response;
  try {
    response = await client.request("/ipfs/work-queue.csv", {
      cache: "no-store",
      headers: { Accept: "text/csv" },
      method: "GET",
    });
  } catch {
    throw new PolicyLedgerApiError("unavailable");
  }
  if (response.status !== 200) {
    if (response.status === 401 || response.status === 403) {
      throw new PolicyLedgerApiError("denied");
    }
    if (response.status === 404 || response.status === 409) {
      throw new PolicyLedgerApiError("conflict");
    }
    throw new PolicyLedgerApiError("unavailable");
  }
  if (response.headers.get("content-type") !== "text/csv; charset=utf-8") {
    throw new PolicyLedgerApiError("invalid_response");
  }
  const disposition = response.headers.get("content-disposition");
  const match = disposition === null
    ? null
    : /^attachment; filename="(WCIB_IPFS_Financed_\d{4}-\d{2}-\d{2}\.csv)"$/.exec(disposition);
  if (match?.[1] === undefined) {
    throw new PolicyLedgerApiError("invalid_response");
  }
  let blob: Blob;
  try {
    blob = await response.blob();
  } catch {
    throw new PolicyLedgerApiError("unavailable");
  }
  if (blob.size === 0) throw new PolicyLedgerApiError("invalid_response");
  return Object.freeze({ blob, filename: match[1] });
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
    throw new PolicyLedgerApiError("unavailable");
  }
  return parseResponse(response, schema);
}

async function mutate<Schema extends z.ZodTypeAny>(
  client: ApiClient,
  path: string,
  body: unknown,
  schema: Schema,
  method: "PATCH" | "POST" = "PATCH",
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
    throw new PolicyLedgerApiError("unavailable");
  }
  return parseResponse(response, schema);
}

async function parseResponse<Schema extends z.ZodTypeAny>(
  response: Response,
  schema: Schema,
): Promise<z.output<Schema>> {
  if (response.status !== 200) {
    if (response.status === 401 || response.status === 403) {
      throw new PolicyLedgerApiError("denied");
    }
    if (response.status === 404 || response.status === 409) {
      throw new PolicyLedgerApiError("conflict");
    }
    if (response.status === 400) {
      throw new PolicyLedgerApiError("rejected");
    }
    throw new PolicyLedgerApiError("unavailable");
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new PolicyLedgerApiError("invalid_response");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new PolicyLedgerApiError("invalid_response");
  }
  return parsed.data;
}

function parseRequest<Schema extends z.ZodTypeAny>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new PolicyLedgerApiError("rejected");
  }
  return parsed.data;
}
