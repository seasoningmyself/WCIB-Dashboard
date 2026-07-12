import type { RequestHandler } from "express";
import { z } from "zod";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  approvalQueueSendBackResponseSchema,
  approvalSendBackRequestSchema,
  flaggedHelpSendBackResponseSchema,
} from "../../shared/approval-queue.js";
import { approveWithOverrideRequestSchema } from "../../shared/policy-overrides.js";
import {
  submitDraftRequestSchema,
  updateDraftRequestSchema,
} from "../../shared/drafts.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import { APPROVAL_ADMIN_ACCESS } from "../approval-queue/access.js";
import {
  ApprovalOverrideValidationError,
  type ApprovalWithOverrideResult,
} from "../approval-queue/approve-with-override.js";
import { projectAdminApprovalQueueEntry } from "../approval-queue/projection.js";
import {
  ApprovalItemNotFoundError,
  ApprovalItemStateError,
  ApprovalSnapshotError,
} from "../approval-queue/approve.js";
import type {
  ApprovalQueueEntryRecord,
  DraftRecord,
  PolicyRecord,
} from "../db/schema.js";
import { projectDraftForAuthorizedContext } from "../drafts/projection.js";
import type { AppLogger } from "../logging/logger.js";
import { projectAdminPolicy } from "../policies/projection.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const APPROVE_SUBMISSION_PATH =
  "/api/approvals/:queueEntryId/approve";
export const APPROVE_WITH_OVERRIDE_PATH =
  "/api/approvals/:queueEntryId/approve-with-override";
export const PUSH_THROUGH_HELP_PATH =
  "/api/approvals/help/:draftId/push-through";
export const OPEN_FIX_HELP_PATH = "/api/approvals/help/:draftId/open-fix";
export const SEND_BACK_SUBMISSION_PATH =
  "/api/approvals/:queueEntryId/send-back";
export const SEND_BACK_HELP_PATH = "/api/approvals/help/:draftId/send-back";

const queueEntryParamsSchema = z
  .object({ queueEntryId: z.string().uuid() })
  .strict();
const helpDraftParamsSchema = z.object({ draftId: z.string().uuid() }).strict();

export interface ApprovalActionHandlerDependencies {
  approve(
    context: AuthorizedRequestContext,
    queueEntryId: string,
  ): Promise<PolicyRecord>;
  approveFixedHelp(
    context: AuthorizedRequestContext,
    draftId: string,
    patch: unknown,
  ): Promise<PolicyRecord>;
  approveWithOverride(
    context: AuthorizedRequestContext,
    queueEntryId: string,
    input: unknown,
  ): Promise<ApprovalWithOverrideResult>;
  logger: AppLogger;
  pushThroughHelp(
    context: AuthorizedRequestContext,
    draftId: string,
  ): Promise<PolicyRecord>;
  sendBackHelp(
    context: AuthorizedRequestContext,
    draftId: string,
    input: unknown,
  ): Promise<DraftRecord>;
  sendBackSubmission(
    context: AuthorizedRequestContext,
    queueEntryId: string,
    input: unknown,
  ): Promise<ApprovalQueueEntryRecord>;
}

export interface RegisterApprovalActionRoutesOptions
  extends ApprovalActionHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createApproveSubmissionHandler(
  dependencies: ApprovalActionHandlerDependencies,
): RequestHandler {
  return createPolicyActionHandler(
    dependencies,
    "queue_submission_approved",
    async (req, context) => {
      submitDraftRequestSchema.parse(req.body ?? {});
      const { queueEntryId } = queueEntryParamsSchema.parse(req.params);
      return {
        sourceId: queueEntryId,
        policy: await dependencies.approve(context, queueEntryId),
      };
    },
  );
}

export function createApproveWithOverrideHandler(
  dependencies: ApprovalActionHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const input = approveWithOverrideRequestSchema.parse(req.body);
    const { queueEntryId } = queueEntryParamsSchema.parse(req.params);
    let result: ApprovalWithOverrideResult;
    try {
      result = await dependencies.approveWithOverride(
        context,
        queueEntryId,
        input,
      );
    } catch (error) {
      throw mapApprovalActionError(error);
    }

    const policy = projectAuthorizedFields(
      res,
      result.policy,
      projectAdminPolicy,
    );
    if (policy === null) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }
    dependencies.logger.info("Approval override completed", {
      component: "approval_queue",
      event: "queue_submission_approved_with_override",
      overrideId: result.overrideId,
      policyId: policy.id,
      sourceId: queueEntryId,
      userId: context.principal.userId,
    });
    res.status(201).set("Cache-Control", "no-store").json({
      overrideId: result.overrideId,
      policy,
    });
  });
}

export function createPushThroughHelpHandler(
  dependencies: ApprovalActionHandlerDependencies,
): RequestHandler {
  return createPolicyActionHandler(
    dependencies,
    "flagged_help_pushed_through",
    async (req, context) => {
      submitDraftRequestSchema.parse(req.body ?? {});
      const { draftId } = helpDraftParamsSchema.parse(req.params);
      return {
        sourceId: draftId,
        policy: await dependencies.pushThroughHelp(context, draftId),
      };
    },
  );
}

export function createOpenFixHelpHandler(
  dependencies: ApprovalActionHandlerDependencies,
): RequestHandler {
  return createPolicyActionHandler(
    dependencies,
    "flagged_help_fixed",
    async (req, context) => {
      const patch = updateDraftRequestSchema.parse(req.body);
      const { draftId } = helpDraftParamsSchema.parse(req.params);
      return {
        sourceId: draftId,
        policy: await dependencies.approveFixedHelp(context, draftId, patch),
      };
    },
  );
}

export function createSendBackSubmissionHandler(
  dependencies: ApprovalActionHandlerDependencies,
): RequestHandler {
  return createSendBackActionHandler(
    dependencies,
    "queue_submission_sent_back",
    async (req, context) => {
      const input = approvalSendBackRequestSchema.parse(req.body);
      const { queueEntryId } = queueEntryParamsSchema.parse(req.params);
      return {
        kind: "entry",
        source: await dependencies.sendBackSubmission(
          context,
          queueEntryId,
          input,
        ),
        sourceId: queueEntryId,
      };
    },
  );
}

export function createSendBackHelpHandler(
  dependencies: ApprovalActionHandlerDependencies,
): RequestHandler {
  return createSendBackActionHandler(
    dependencies,
    "flagged_help_sent_back",
    async (req, context) => {
      const input = approvalSendBackRequestSchema.parse(req.body);
      const { draftId } = helpDraftParamsSchema.parse(req.params);
      return {
        kind: "draft",
        source: await dependencies.sendBackHelp(context, draftId, input),
        sourceId: draftId,
      };
    },
  );
}

export function registerApprovalActionRoutes(
  routes: RouteRegistrar,
  options: RegisterApprovalActionRoutesOptions,
): void {
  const access = {
    authorization: options.authorization.require(APPROVAL_ADMIN_ACCESS),
  };
  routes.post(
    APPROVE_SUBMISSION_PATH,
    access,
    createApproveSubmissionHandler(options),
  );
  routes.post(
    APPROVE_WITH_OVERRIDE_PATH,
    access,
    createApproveWithOverrideHandler(options),
  );
  routes.post(
    PUSH_THROUGH_HELP_PATH,
    access,
    createPushThroughHelpHandler(options),
  );
  routes.post(
    OPEN_FIX_HELP_PATH,
    access,
    createOpenFixHelpHandler(options),
  );
  routes.post(
    SEND_BACK_SUBMISSION_PATH,
    access,
    createSendBackSubmissionHandler(options),
  );
  routes.post(
    SEND_BACK_HELP_PATH,
    access,
    createSendBackHelpHandler(options),
  );
}

type SendBackActionResult =
  | {
      kind: "draft";
      source: DraftRecord;
      sourceId: string;
    }
  | {
      kind: "entry";
      source: ApprovalQueueEntryRecord;
      sourceId: string;
    };

function createSendBackActionHandler(
  dependencies: ApprovalActionHandlerDependencies,
  event: string,
  run: (
    req: Parameters<RequestHandler>[0],
    context: AuthorizedRequestContext,
  ) => Promise<SendBackActionResult>,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    let result: SendBackActionResult;
    try {
      result = await run(req, context);
    } catch (error) {
      throw mapApprovalActionError(error);
    }

    let response;
    if (result.kind === "entry") {
      const entry = projectAuthorizedFields(
        res,
        result.source,
        projectAdminApprovalQueueEntry,
      );
      if (entry === null) {
        throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
      }
      response = approvalQueueSendBackResponseSchema.parse({ entry });
    } else {
      const draft = projectAuthorizedFields(
        res,
        result.source,
        projectDraftForAuthorizedContext,
      );
      if (draft === null) {
        throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
      }
      response = flaggedHelpSendBackResponseSchema.parse({ draft });
    }
    dependencies.logger.info("Approval send-back completed", {
      component: "approval_queue",
      event,
      sourceId: result.sourceId,
      userId: context.principal.userId,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

function createPolicyActionHandler(
  dependencies: ApprovalActionHandlerDependencies,
  event: string,
  run: (
    req: Parameters<RequestHandler>[0],
    context: AuthorizedRequestContext,
  ) => Promise<{ policy: PolicyRecord; sourceId: string }>,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    let result;
    try {
      result = await run(req, context);
    } catch (error) {
      throw mapApprovalActionError(error);
    }

    const policy = projectAuthorizedFields(
      res,
      result.policy,
      projectAdminPolicy,
    );
    if (policy === null) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }
    dependencies.logger.info("Approval action completed", {
      component: "approval_queue",
      event,
      policyId: policy.id,
      sourceId: result.sourceId,
      userId: context.principal.userId,
    });
    res.status(201).set("Cache-Control", "no-store").json({ policy });
  });
}

function mapApprovalActionError(error: unknown): unknown {
  if (error instanceof ApprovalItemNotFoundError) {
    return new HttpError(404, apiErrorCodes.notFound, "Approval item not found");
  }
  if (
    error instanceof ApprovalItemStateError ||
    error instanceof ApprovalSnapshotError
  ) {
    return new HttpError(
      409,
      apiErrorCodes.badRequest,
      "Approval item is not actionable",
    );
  }
  if (error instanceof ApprovalOverrideValidationError) {
    return new HttpError(
      400,
      apiErrorCodes.badRequest,
      "Approval override is invalid",
    );
  }
  return error;
}
