import type { RequestHandler } from "express";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  approvalWorkDeletionParamsSchema,
  approvalWorkRestoreRequestSchema,
  approvalWorkRestoreResponseSchema,
  approvalWorkSoftDeleteRequestSchema,
  approvalWorkSoftDeleteResponseSchema,
  deletedApprovalWorkListResponseSchema,
  type ApprovalWorkDeletionKind,
  type ApprovalWorkSoftDeleteKind,
} from "../../shared/approval-work-deletions.js";
import { APPROVAL_ADMIN_ACCESS } from "../approval-queue/access.js";
import {
  projectAdminActiveApprovalWork,
  projectAdminDeletedApprovalWork,
} from "../approval-queue/deletion-projection.js";
import {
  ApprovalWorkDeletionNotFoundError,
  ApprovalWorkDeletionStaleError,
  ApprovalWorkDeletionStateError,
  type ApprovalWorkDeletionResult,
  type ApprovalWorkDeletionSource,
} from "../approval-queue/soft-delete.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import type { AppLogger } from "../logging/logger.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const DELETED_APPROVAL_WORK_LIST_PATH = "/api/deleted-approval-work";
export const APPROVAL_SUBMISSION_SOFT_DELETE_PATH =
  "/api/approvals/:id/soft-delete";
export const APPROVAL_HELP_SOFT_DELETE_PATH =
  "/api/approvals/help/:id/soft-delete";
export const APPROVAL_SUBMISSION_RESTORE_PATH =
  "/api/deleted-approval-work/submissions/:id/restore";
export const APPROVAL_HELP_RESTORE_PATH =
  "/api/deleted-approval-work/help/:id/restore";
export const APPROVAL_DRAFT_RESTORE_PATH =
  "/api/deleted-approval-work/drafts/:id/restore";

export interface ApprovalWorkDeletionHandlerDependencies {
  list(
    context: AuthorizedRequestContext,
  ): Promise<readonly ApprovalWorkDeletionSource[]>;
  logger: AppLogger;
  restore(
    context: AuthorizedRequestContext,
    kind: ApprovalWorkDeletionKind,
    targetId: string,
    input: unknown,
  ): Promise<ApprovalWorkDeletionResult>;
  softDelete(
    context: AuthorizedRequestContext,
    kind: ApprovalWorkSoftDeleteKind,
    targetId: string,
    input: unknown,
  ): Promise<ApprovalWorkDeletionResult>;
}

export interface RegisterApprovalWorkDeletionRoutesOptions
  extends ApprovalWorkDeletionHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createDeletedApprovalWorkListHandler(
  dependencies: ApprovalWorkDeletionHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (_req, res) => {
    const context = getAuthorizedRequestContext(res);
    const source = await dependencies.list(context);
    const response = deletedApprovalWorkListResponseSchema.parse({
      items: source.map((item) => {
        const projected = projectAuthorizedFields(
          res,
          item,
          projectAdminDeletedApprovalWork,
        );
        if (projected === null) throw forbidden();
        return projected;
      }),
    });
    dependencies.logger.info("Deleted approval work loaded", {
      component: "approval_work_deletion",
      event: "deleted_approval_work_list_read",
      resultCount: response.items.length,
      userId: context.principal.userId,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function createApprovalWorkSoftDeleteHandler(
  dependencies: ApprovalWorkDeletionHandlerDependencies,
  kind: ApprovalWorkSoftDeleteKind,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { id } = approvalWorkDeletionParamsSchema.parse(req.params);
    const input = approvalWorkSoftDeleteRequestSchema.parse(req.body);
    let result: ApprovalWorkDeletionResult;
    try {
      result = await dependencies.softDelete(context, kind, id, input);
    } catch (error) {
      throw mapApprovalWorkDeletionError(error);
    }
    const item = projectAuthorizedFields(
      res,
      result.source,
      projectAdminDeletedApprovalWork,
    );
    if (item === null) throw forbidden();
    const response = approvalWorkSoftDeleteResponseSchema.parse({
      changed: result.changed,
      item,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function createApprovalWorkRestoreHandler(
  dependencies: ApprovalWorkDeletionHandlerDependencies,
  kind: ApprovalWorkDeletionKind,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { id } = approvalWorkDeletionParamsSchema.parse(req.params);
    const input = approvalWorkRestoreRequestSchema.parse(req.body);
    let result: ApprovalWorkDeletionResult;
    try {
      result = await dependencies.restore(context, kind, id, input);
    } catch (error) {
      throw mapApprovalWorkDeletionError(error);
    }
    const item = projectAuthorizedFields(
      res,
      result.source,
      projectAdminActiveApprovalWork,
    );
    if (item === null) throw forbidden();
    const response = approvalWorkRestoreResponseSchema.parse({
      changed: result.changed,
      item,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerApprovalWorkDeletionRoutes(
  routes: RouteRegistrar,
  options: RegisterApprovalWorkDeletionRoutesOptions,
): void {
  const access = {
    authorization: options.authorization.require(APPROVAL_ADMIN_ACCESS),
  };
  routes.get(
    DELETED_APPROVAL_WORK_LIST_PATH,
    access,
    createDeletedApprovalWorkListHandler(options),
  );
  routes.post(
    APPROVAL_SUBMISSION_SOFT_DELETE_PATH,
    access,
    createApprovalWorkSoftDeleteHandler(options, "submission"),
  );
  routes.post(
    APPROVAL_HELP_SOFT_DELETE_PATH,
    access,
    createApprovalWorkSoftDeleteHandler(options, "help"),
  );
  routes.post(
    APPROVAL_SUBMISSION_RESTORE_PATH,
    access,
    createApprovalWorkRestoreHandler(options, "submission"),
  );
  routes.post(
    APPROVAL_HELP_RESTORE_PATH,
    access,
    createApprovalWorkRestoreHandler(options, "help"),
  );
  routes.post(
    APPROVAL_DRAFT_RESTORE_PATH,
    access,
    createApprovalWorkRestoreHandler(options, "draft"),
  );
}

function mapApprovalWorkDeletionError(error: unknown): unknown {
  if (error instanceof ApprovalWorkDeletionNotFoundError) {
    return new HttpError(404, apiErrorCodes.notFound, "Approval work not found");
  }
  if (error instanceof ApprovalWorkDeletionStaleError) {
    return new HttpError(
      409,
      apiErrorCodes.badRequest,
      "Approval work changed; reload and try again",
    );
  }
  if (error instanceof ApprovalWorkDeletionStateError) {
    return new HttpError(
      409,
      apiErrorCodes.badRequest,
      "Approval work cannot be changed in its current state",
    );
  }
  return error;
}

function forbidden(): HttpError {
  return new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
}
