import type { RequestHandler } from "express";
import { z } from "zod";
import { apiErrorCodes } from "../../shared/api-errors.js";
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
  ApprovalItemNotFoundError,
  ApprovalItemStateError,
  ApprovalSnapshotError,
} from "../approval-queue/approve.js";
import type { PolicyRecord } from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import { projectAdminPolicy } from "../policies/projection.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const APPROVE_SUBMISSION_PATH =
  "/api/approvals/:queueEntryId/approve";
export const PUSH_THROUGH_HELP_PATH =
  "/api/approvals/help/:draftId/push-through";
export const OPEN_FIX_HELP_PATH = "/api/approvals/help/:draftId/open-fix";

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
  logger: AppLogger;
  pushThroughHelp(
    context: AuthorizedRequestContext,
    draftId: string,
  ): Promise<PolicyRecord>;
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
    PUSH_THROUGH_HELP_PATH,
    access,
    createPushThroughHelpHandler(options),
  );
  routes.post(
    OPEN_FIX_HELP_PATH,
    access,
    createOpenFixHelpHandler(options),
  );
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
      if (error instanceof ApprovalItemNotFoundError) {
        throw new HttpError(404, apiErrorCodes.notFound, "Approval item not found");
      }
      if (
        error instanceof ApprovalItemStateError ||
        error instanceof ApprovalSnapshotError
      ) {
        throw new HttpError(
          409,
          apiErrorCodes.badRequest,
          "Approval item is not actionable",
        );
      }
      throw error;
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
