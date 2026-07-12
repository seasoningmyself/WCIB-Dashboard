import type { RequestHandler } from "express";
import {
  approvalWorkListResponseSchema,
  listApprovalWorkQuerySchema,
  type ApprovalWorkListResponse,
} from "../../shared/approval-queue.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import { APPROVAL_ADMIN_ACCESS } from "../approval-queue/access.js";
import {
  projectAdminApprovalQueueEntry,
} from "../approval-queue/projection.js";
import type { ApprovalWorkSource } from "../approval-queue/list.js";
import { projectDraftForAuthorizedContext } from "../drafts/projection.js";
import type { AppLogger } from "../logging/logger.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import type { RouteRegistrar } from "./routes.js";

export const APPROVAL_WORK_PATH = "/api/approvals";

export interface ApprovalWorkHandlerDependencies {
  list(
    context: AuthorizedRequestContext,
    query: unknown,
  ): Promise<ApprovalWorkSource>;
  logger: AppLogger;
}

export interface RegisterApprovalWorkRouteOptions
  extends ApprovalWorkHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createApprovalWorkHandler(
  dependencies: ApprovalWorkHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const query = listApprovalWorkQuerySchema.parse(req.query);
    const source = await dependencies.list(context, query);

    const submissions = source.submissions.map((item) => ({
      entry: projectAuthorizedFields(
        res,
        item.entry,
        projectAdminApprovalQueueEntry,
      ),
      submitterDisplayName: item.submitterDisplayName,
    }));
    const helpRequests = source.helpRequests.map((item) => ({
      draft: projectAuthorizedFields(
        res,
        item.draft,
        projectDraftForAuthorizedContext,
      ),
      submitterDisplayName: item.submitterDisplayName,
    }));
    if (
      submissions.some(({ entry }) => entry === null) ||
      helpRequests.some(({ draft }) => draft === null)
    ) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }

    const response: ApprovalWorkListResponse =
      approvalWorkListResponseSchema.parse({ helpRequests, submissions });
    dependencies.logger.info("Approval work loaded", {
      component: "approval_queue",
      event: "approval_work_read",
      helpRequestCount: response.helpRequests.length,
      status: query.status,
      submissionCount: response.submissions.length,
      userId: context.principal.userId,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerApprovalWorkRoute(
  routes: RouteRegistrar,
  options: RegisterApprovalWorkRouteOptions,
): void {
  routes.get(
    APPROVAL_WORK_PATH,
    {
      authorization: options.authorization.require(APPROVAL_ADMIN_ACCESS),
    },
    createApprovalWorkHandler(options),
  );
}
