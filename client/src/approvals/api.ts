import { z } from "zod";
import {
  approvalQueueSendBackResponseSchema,
  approvalSendBackRequestSchema,
  approvalWorkListResponseSchema,
  flaggedHelpSendBackResponseSchema,
  listApprovalWorkQuerySchema,
  type ApprovalSendBackRequest,
  type ApprovalWorkListResponse,
  type ListApprovalWorkQuery,
} from "../../../shared/approval-queue.js";
import {
  approvalWorkRestoreRequestSchema,
  approvalWorkRestoreResponseSchema,
  approvalWorkSoftDeleteRequestSchema,
  approvalWorkSoftDeleteResponseSchema,
  deletedApprovalWorkListResponseSchema,
  type ApprovalWorkDeletionKind,
  type ApprovalWorkSoftDeleteKind,
  type ApprovalWorkRestoreRequest,
  type ApprovalWorkRestoreResponse,
  type ApprovalWorkSoftDeleteRequest,
  type ApprovalWorkSoftDeleteResponse,
  type DeletedApprovalWorkListResponse,
} from "../../../shared/approval-work-deletions.js";
import {
  submitDraftRequestSchema,
  updateDraftRequestSchema,
  type UpdateDraftRequest,
} from "../../../shared/drafts.js";
import {
  approveWithOverrideRequestSchema,
  type ApproveWithOverrideRequest,
} from "../../../shared/policy-overrides.js";
import {
  policyChangeRequestCorrectionResponseSchema,
  policyChangeRequestResolutionResponseSchema,
  resolvePolicyChangeRequestAsIsSchema,
  sendBackPolicyChangeRequestSchema,
} from "../../../shared/policy-change-requests.js";
import {
  policyLedgerCorrectionRequestSchema,
  type PolicyLedgerCorrectionRequest,
} from "../../../shared/policy-corrections.js";
import type { ApiClient } from "../api/client.js";

const policyIdentityResponseSchema = z
  .object({
    policy: z.object({ id: z.string().uuid() }).passthrough(),
  })
  .strict()
  .transform(({ policy }) => ({ policyId: policy.id }));

const overrideIdentityResponseSchema = z
  .object({
    overrideId: z.string().uuid(),
    policy: z.object({ id: z.string().uuid() }).passthrough(),
  })
  .strict()
  .transform(({ overrideId, policy }) => ({
    overrideId,
    policyId: policy.id,
  }));

export type ApprovalApiErrorKind =
  | "conflict"
  | "denied"
  | "invalid_response"
  | "rejected"
  | "unavailable";

export class ApprovalApiError extends Error {
  constructor(readonly kind: ApprovalApiErrorKind) {
    super("Approval request could not be completed");
    this.name = "ApprovalApiError";
  }
}

export interface ApprovalApi {
  approve(queueEntryId: string): Promise<{ policyId: string }>;
  approveWithOverride(
    queueEntryId: string,
    input: ApproveWithOverrideRequest,
  ): Promise<{ overrideId: string; policyId: string }>;
  correctPolicyChangeRequest(
    requestId: string,
    input: PolicyLedgerCorrectionRequest,
  ): Promise<z.output<typeof policyChangeRequestCorrectionResponseSchema>>;
  editFixSubmission(
    queueEntryId: string,
    input: UpdateDraftRequest,
  ): Promise<{ policyId: string }>;
  listDeleted(): Promise<DeletedApprovalWorkListResponse>;
  list(query?: Partial<ListApprovalWorkQuery>): Promise<ApprovalWorkListResponse>;
  openFixHelp(
    draftId: string,
    input: UpdateDraftRequest,
  ): Promise<{ policyId: string }>;
  pushThroughHelp(draftId: string): Promise<{ policyId: string }>;
  resolvePolicyChangeRequestAsIs(
    requestId: string,
  ): Promise<z.output<typeof policyChangeRequestResolutionResponseSchema>>;
  restoreDeleted(
    kind: ApprovalWorkDeletionKind,
    targetId: string,
    input: ApprovalWorkRestoreRequest,
  ): Promise<ApprovalWorkRestoreResponse>;
  sendBackHelp(draftId: string, input: ApprovalSendBackRequest): Promise<void>;
  sendBackSubmission(
    queueEntryId: string,
    input: ApprovalSendBackRequest,
  ): Promise<void>;
  sendBackPolicyChangeRequest(
    requestId: string,
    input: ApprovalSendBackRequest,
  ): Promise<z.output<typeof policyChangeRequestResolutionResponseSchema>>;
  softDelete(
    kind: ApprovalWorkSoftDeleteKind,
    targetId: string,
    input: ApprovalWorkSoftDeleteRequest,
  ): Promise<ApprovalWorkSoftDeleteResponse>;
}

export function createApprovalApi(client: ApiClient): ApprovalApi {
  return {
    async approve(queueEntryId) {
      return mutate(
        client,
        `/approvals/${encodeURIComponent(queueEntryId)}/approve`,
        submitDraftRequestSchema.parse({}),
        policyIdentityResponseSchema,
      );
    },
    async approveWithOverride(queueEntryId, input) {
      return mutate(
        client,
        `/approvals/${encodeURIComponent(queueEntryId)}/approve-with-override`,
        parseRequest(approveWithOverrideRequestSchema, input),
        overrideIdentityResponseSchema,
      );
    },
    correctPolicyChangeRequest: (requestId, input) =>
      mutate(
        client,
        `/policy-change-requests/${encodeURIComponent(requestId)}/correction`,
        parseRequest(policyLedgerCorrectionRequestSchema, input),
        policyChangeRequestCorrectionResponseSchema,
        200,
        "PATCH",
      ),
    async editFixSubmission(queueEntryId, input) {
      return mutate(
        client,
        `/approvals/${encodeURIComponent(queueEntryId)}/open-fix`,
        parseRequest(updateDraftRequestSchema, input),
        policyIdentityResponseSchema,
      );
    },
    async list(query = {}) {
      const normalized = parseRequest(listApprovalWorkQuerySchema, query);
      const params = new URLSearchParams();
      if (normalized.status !== "all") {
        params.set("status", normalized.status);
      }
      const suffix = params.size === 0 ? "" : `?${params.toString()}`;
      return read(client, `/approvals${suffix}`, approvalWorkListResponseSchema);
    },
    listDeleted: () =>
      read(
        client,
        "/deleted-approval-work",
        deletedApprovalWorkListResponseSchema,
      ),
    async openFixHelp(draftId, input) {
      return mutate(
        client,
        `/approvals/help/${encodeURIComponent(draftId)}/open-fix`,
        parseRequest(updateDraftRequestSchema, input),
        policyIdentityResponseSchema,
      );
    },
    async pushThroughHelp(draftId) {
      return mutate(
        client,
        `/approvals/help/${encodeURIComponent(draftId)}/push-through`,
        submitDraftRequestSchema.parse({}),
        policyIdentityResponseSchema,
      );
    },
    resolvePolicyChangeRequestAsIs: (requestId) =>
      mutate(
        client,
        `/policy-change-requests/${encodeURIComponent(requestId)}/resolve-as-is`,
        resolvePolicyChangeRequestAsIsSchema.parse({}),
        policyChangeRequestResolutionResponseSchema,
        200,
      ),
    restoreDeleted: (kind, targetId, input) =>
      mutate(
        client,
        `/deleted-approval-work/${restoreKindPath(kind)}/${encodeURIComponent(targetId)}/restore`,
        parseRequest(approvalWorkRestoreRequestSchema, input),
        approvalWorkRestoreResponseSchema,
        200,
      ),
    async sendBackHelp(draftId, input) {
      await mutate(
        client,
        `/approvals/help/${encodeURIComponent(draftId)}/send-back`,
        parseRequest(approvalSendBackRequestSchema, input),
        flaggedHelpSendBackResponseSchema,
        200,
      );
    },
    async sendBackSubmission(queueEntryId, input) {
      await mutate(
        client,
        `/approvals/${encodeURIComponent(queueEntryId)}/send-back`,
        parseRequest(approvalSendBackRequestSchema, input),
        approvalQueueSendBackResponseSchema,
        200,
      );
    },
    sendBackPolicyChangeRequest: (requestId, input) =>
      mutate(
        client,
        `/policy-change-requests/${encodeURIComponent(requestId)}/send-back`,
        parseRequest(sendBackPolicyChangeRequestSchema, input),
        policyChangeRequestResolutionResponseSchema,
        200,
      ),
    softDelete: (kind, targetId, input) =>
      mutate(
        client,
        kind === "submission"
          ? `/approvals/${encodeURIComponent(targetId)}/soft-delete`
          : `/approvals/help/${encodeURIComponent(targetId)}/soft-delete`,
        parseRequest(approvalWorkSoftDeleteRequestSchema, input),
        approvalWorkSoftDeleteResponseSchema,
        200,
      ),
  };
}

function restoreKindPath(kind: ApprovalWorkDeletionKind): string {
  if (kind === "submission") return "submissions";
  if (kind === "help") return "help";
  return "drafts";
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
    throw new ApprovalApiError("unavailable");
  }
  return parseResponse(response, 200, schema);
}

async function mutate<Schema extends z.ZodTypeAny>(
  client: ApiClient,
  path: string,
  body: unknown,
  schema: Schema,
  expectedStatus = 201,
  method: "PATCH" | "POST" = "POST",
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
    throw new ApprovalApiError("unavailable");
  }
  return parseResponse(response, expectedStatus, schema);
}

async function parseResponse<Schema extends z.ZodTypeAny>(
  response: Response,
  expectedStatus: number,
  schema: Schema,
): Promise<z.output<Schema>> {
  if (response.status !== expectedStatus) {
    if (response.status === 400) {
      throw new ApprovalApiError("rejected");
    }
    if (response.status === 403) {
      throw new ApprovalApiError("denied");
    }
    if (response.status === 404 || response.status === 409) {
      throw new ApprovalApiError("conflict");
    }
    throw new ApprovalApiError("unavailable");
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new ApprovalApiError("invalid_response");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApprovalApiError("invalid_response");
  }
  return parsed.data;
}

function parseRequest<Schema extends z.ZodTypeAny>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ApprovalApiError("rejected");
  }
  return parsed.data;
}
