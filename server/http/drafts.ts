import type { RequestHandler } from "express";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  createDraftRequestSchema,
  createDraftResponseSchema,
  draftIdParamsSchema,
  editDraftResponseSchema,
  flagDraftRequestSchema,
  flagDraftResponseSchema,
  listDraftsQuerySchema,
  listDraftsResponseSchema,
  submitDraftRequestSchema,
  submitDraftResponseSchema,
  updateDraftRequestSchema,
  withdrawFlaggedDraftRequestSchema,
  withdrawFlaggedDraftResponseSchema,
  withdrawSubmittedDraftRequestSchema,
  withdrawSubmittedDraftResponseSchema,
  type CreateDraftResponse,
  type ListDraftsResponse,
  type SubmitDraftResponse,
} from "../../shared/drafts.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import {
  DRAFT_HELP_ACCESS,
  DRAFT_SELF_SERVICE_ACCESS,
} from "../drafts/access.js";
import {
  DraftInputValidationError,
} from "../drafts/create.js";
import { projectDraftForAuthorizedContext } from "../drafts/projection.js";
import {
  DraftNotEditableError,
  DraftNotFoundError,
  type DraftEditResult,
} from "../drafts/edit.js";
import {
  DraftNotSubmittableError,
  DraftSubmissionNotFoundError,
  DraftSubmissionValidationError,
  type DraftSubmissionResult,
} from "../drafts/submit.js";
import {
  DraftFlagNotFoundError,
  DraftNotFlaggableError,
} from "../drafts/flag.js";
import {
  DraftHelpWithdrawalNotAllowedError,
  DraftHelpWithdrawalNotFoundError,
} from "../drafts/withdraw-help.js";
import {
  DraftSubmissionWithdrawalNotAllowedError,
  DraftSubmissionWithdrawalNotFoundError,
} from "../drafts/withdraw-submission.js";
import type { DraftRecord } from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const DRAFTS_PATH = "/api/drafts";
export const DRAFT_PATH = "/api/drafts/:draftId";
export const DRAFT_SUBMIT_PATH = "/api/drafts/:draftId/submit";
export const DRAFT_FLAG_PATH = "/api/drafts/:draftId/flag";
export const DRAFT_WITHDRAW_HELP_PATH = "/api/drafts/:draftId/withdraw-help";
export const DRAFT_WITHDRAW_SUBMISSION_PATH =
  "/api/drafts/:draftId/withdraw-submission";

export interface DraftCreateHandlerDependencies {
  create(
    context: AuthorizedRequestContext,
    input: unknown,
  ): Promise<DraftRecord>;
  logger: AppLogger;
}

export interface RegisterDraftCreateRouteOptions
  extends DraftCreateHandlerDependencies {
  authorization: AuthorizationGuards;
}

export interface DraftListHandlerDependencies {
  list(
    context: AuthorizedRequestContext,
    query: unknown,
  ): Promise<readonly DraftRecord[]>;
  logger: AppLogger;
}

export interface RegisterDraftListRouteOptions
  extends DraftListHandlerDependencies {
  authorization: AuthorizationGuards;
}

export interface DraftEditHandlerDependencies {
  edit(
    context: AuthorizedRequestContext,
    draftId: string,
    input: unknown,
  ): Promise<DraftEditResult>;
  logger: AppLogger;
}

export interface RegisterDraftEditRouteOptions
  extends DraftEditHandlerDependencies {
  authorization: AuthorizationGuards;
}

export interface DraftSubmitHandlerDependencies {
  logger: AppLogger;
  submit(
    context: AuthorizedRequestContext,
    draftId: string,
  ): Promise<DraftSubmissionResult>;
}

export interface RegisterDraftSubmitRouteOptions
  extends DraftSubmitHandlerDependencies {
  authorization: AuthorizationGuards;
}

export interface DraftFlagHandlerDependencies {
  flag(
    context: AuthorizedRequestContext,
    draftId: string,
    input: unknown,
  ): Promise<DraftRecord>;
  logger: AppLogger;
}

export interface RegisterDraftFlagRouteOptions
  extends DraftFlagHandlerDependencies {
  authorization: AuthorizationGuards;
}

export interface DraftWithdrawHelpHandlerDependencies {
  logger: AppLogger;
  withdraw(
    context: AuthorizedRequestContext,
    draftId: string,
  ): Promise<DraftRecord>;
}

export interface RegisterDraftWithdrawHelpRouteOptions
  extends DraftWithdrawHelpHandlerDependencies {
  authorization: AuthorizationGuards;
}

export interface DraftWithdrawSubmissionHandlerDependencies {
  logger: AppLogger;
  withdraw(
    context: AuthorizedRequestContext,
    draftId: string,
  ): Promise<DraftRecord>;
}

export interface RegisterDraftWithdrawSubmissionRouteOptions
  extends DraftWithdrawSubmissionHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createDraftCreateHandler(
  dependencies: DraftCreateHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const input = createDraftRequestSchema.parse(req.body);
    let record: DraftRecord;
    try {
      record = await dependencies.create(context, input);
    } catch (error) {
      if (error instanceof DraftInputValidationError) {
        throw new HttpError(
          400,
          apiErrorCodes.validation,
          "Request validation failed",
          error.details,
        );
      }
      throw error;
    }

    const draft = projectAuthorizedFields(
      res,
      record,
      projectDraftForAuthorizedContext,
    );
    if (draft === null) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }
    const response: CreateDraftResponse = createDraftResponseSchema.parse({
      draft,
    });
    dependencies.logger.info("Draft created", {
      component: "drafts",
      draftId: response.draft.id,
      event: "draft_created",
      userId: context.principal.userId,
    });
    res.status(201).set("Cache-Control", "no-store").json(response);
  });
}

export function registerDraftCreateRoute(
  routes: RouteRegistrar,
  options: RegisterDraftCreateRouteOptions,
): void {
  routes.post(
    DRAFTS_PATH,
    {
      authorization: options.authorization.require(DRAFT_SELF_SERVICE_ACCESS),
    },
    createDraftCreateHandler(options),
  );
}

export function createDraftListHandler(
  dependencies: DraftListHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const query = listDraftsQuerySchema.parse(req.query);
    const records = await dependencies.list(context, query);
    const projected = records.map((record) =>
      projectAuthorizedFields(res, record, projectDraftForAuthorizedContext),
    );
    if (projected.some((draft) => draft === null)) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }
    const response: ListDraftsResponse = listDraftsResponseSchema.parse({
      drafts: projected,
    });
    dependencies.logger.info("Own drafts loaded", {
      component: "drafts",
      count: response.drafts.length,
      event: "own_drafts_read",
      status: query.status ?? "all",
      userId: context.principal.userId,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerDraftListRoute(
  routes: RouteRegistrar,
  options: RegisterDraftListRouteOptions,
): void {
  routes.get(
    DRAFTS_PATH,
    {
      authorization: options.authorization.require(DRAFT_SELF_SERVICE_ACCESS),
    },
    createDraftListHandler(options),
  );
}

export function createDraftEditHandler(
  dependencies: DraftEditHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { draftId } = draftIdParamsSchema.parse(req.params);
    const input = updateDraftRequestSchema.parse(req.body);
    let result: DraftEditResult;
    try {
      result = await dependencies.edit(context, draftId, input);
    } catch (error) {
      if (error instanceof DraftInputValidationError) {
        throw new HttpError(
          400,
          apiErrorCodes.validation,
          "Request validation failed",
          error.details,
        );
      }
      if (error instanceof DraftNotFoundError) {
        throw new HttpError(404, apiErrorCodes.notFound, "Draft not found");
      }
      if (error instanceof DraftNotEditableError) {
        throw new HttpError(409, apiErrorCodes.badRequest, "Draft is not editable");
      }
      throw error;
    }
    const projected = projectAuthorizedFields(
      res,
      result.draft,
      projectDraftForAuthorizedContext,
    );
    if (projected === null) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }
    const response = editDraftResponseSchema.parse({ draft: projected });
    dependencies.logger.info("Own draft edited", {
      component: "drafts",
      draftId: response.draft.id,
      event: "own_draft_edited",
      previousStatus: result.previousStatus,
      userId: context.principal.userId,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerDraftEditRoute(
  routes: RouteRegistrar,
  options: RegisterDraftEditRouteOptions,
): void {
  routes.patch(
    DRAFT_PATH,
    {
      authorization: options.authorization.require(DRAFT_SELF_SERVICE_ACCESS),
    },
    createDraftEditHandler(options),
  );
}

export function createDraftSubmitHandler(
  dependencies: DraftSubmitHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { draftId } = draftIdParamsSchema.parse(req.params);
    submitDraftRequestSchema.parse(req.body ?? {});
    let result: DraftSubmissionResult;
    try {
      result = await dependencies.submit(context, draftId);
    } catch (error) {
      if (error instanceof DraftInputValidationError) {
        throw new HttpError(
          400,
          apiErrorCodes.validation,
          "Request validation failed",
          error.details,
        );
      }
      if (error instanceof DraftSubmissionValidationError) {
        throw new HttpError(
          400,
          apiErrorCodes.validation,
          "Draft is incomplete",
          error.details,
        );
      }
      if (error instanceof DraftSubmissionNotFoundError) {
        throw new HttpError(404, apiErrorCodes.notFound, "Draft not found");
      }
      if (error instanceof DraftNotSubmittableError) {
        throw new HttpError(
          409,
          apiErrorCodes.badRequest,
          "Draft is not submittable",
        );
      }
      throw error;
    }

    const draft = projectAuthorizedFields(
      res,
      result.draft,
      projectDraftForAuthorizedContext,
    );
    if (draft === null) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }
    const response: SubmitDraftResponse = submitDraftResponseSchema.parse({
      destination: result.destination,
      draft,
    });
    dependencies.logger.info("Own draft submitted", {
      component: "drafts",
      destination: response.destination,
      draftId: response.draft.id,
      event: "own_draft_submitted",
      userId: context.principal.userId,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerDraftSubmitRoute(
  routes: RouteRegistrar,
  options: RegisterDraftSubmitRouteOptions,
): void {
  routes.post(
    DRAFT_SUBMIT_PATH,
    {
      authorization: options.authorization.require(DRAFT_SELF_SERVICE_ACCESS),
    },
    createDraftSubmitHandler(options),
  );
}

export function createDraftFlagHandler(
  dependencies: DraftFlagHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { draftId } = draftIdParamsSchema.parse(req.params);
    const input = flagDraftRequestSchema.parse(req.body);
    let record: DraftRecord;
    try {
      record = await dependencies.flag(context, draftId, input);
    } catch (error) {
      if (error instanceof DraftFlagNotFoundError) {
        throw new HttpError(404, apiErrorCodes.notFound, "Draft not found");
      }
      if (error instanceof DraftNotFlaggableError) {
        throw new HttpError(
          409,
          apiErrorCodes.badRequest,
          "Draft is not flaggable",
        );
      }
      throw error;
    }

    const draft = projectAuthorizedFields(
      res,
      record,
      projectDraftForAuthorizedContext,
    );
    if (draft === null) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }
    const response = flagDraftResponseSchema.parse({ draft });
    dependencies.logger.info("Own draft flagged for help", {
      component: "drafts",
      draftId: response.draft.id,
      event: "own_draft_flagged",
      userId: context.principal.userId,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerDraftFlagRoute(
  routes: RouteRegistrar,
  options: RegisterDraftFlagRouteOptions,
): void {
  routes.post(
    DRAFT_FLAG_PATH,
    {
      authorization: options.authorization.require(DRAFT_HELP_ACCESS),
    },
    createDraftFlagHandler(options),
  );
}

export function createDraftWithdrawHelpHandler(
  dependencies: DraftWithdrawHelpHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { draftId } = draftIdParamsSchema.parse(req.params);
    withdrawFlaggedDraftRequestSchema.parse(req.body ?? {});
    let record: DraftRecord;
    try {
      record = await dependencies.withdraw(context, draftId);
    } catch (error) {
      if (error instanceof DraftHelpWithdrawalNotFoundError) {
        throw new HttpError(404, apiErrorCodes.notFound, "Draft not found");
      }
      if (error instanceof DraftHelpWithdrawalNotAllowedError) {
        throw new HttpError(
          409,
          apiErrorCodes.badRequest,
          "Draft help request is not withdrawable",
        );
      }
      throw error;
    }

    const draft = projectAuthorizedFields(
      res,
      record,
      projectDraftForAuthorizedContext,
    );
    if (draft === null) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }
    const response = withdrawFlaggedDraftResponseSchema.parse({ draft });
    dependencies.logger.info("Own help request withdrawn", {
      component: "drafts",
      draftId: response.draft.id,
      event: "own_draft_help_withdrawn",
      userId: context.principal.userId,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerDraftWithdrawHelpRoute(
  routes: RouteRegistrar,
  options: RegisterDraftWithdrawHelpRouteOptions,
): void {
  routes.post(
    DRAFT_WITHDRAW_HELP_PATH,
    {
      authorization: options.authorization.require(DRAFT_HELP_ACCESS),
    },
    createDraftWithdrawHelpHandler(options),
  );
}

export function createDraftWithdrawSubmissionHandler(
  dependencies: DraftWithdrawSubmissionHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { draftId } = draftIdParamsSchema.parse(req.params);
    withdrawSubmittedDraftRequestSchema.parse(req.body ?? {});
    let record: DraftRecord;
    try {
      record = await dependencies.withdraw(context, draftId);
    } catch (error) {
      if (error instanceof DraftSubmissionWithdrawalNotFoundError) {
        throw new HttpError(404, apiErrorCodes.notFound, "Draft not found");
      }
      if (error instanceof DraftSubmissionWithdrawalNotAllowedError) {
        throw new HttpError(
          409,
          apiErrorCodes.badRequest,
          "Draft submission is not withdrawable",
        );
      }
      throw error;
    }

    const draft = projectAuthorizedFields(
      res,
      record,
      projectDraftForAuthorizedContext,
    );
    if (draft === null) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }
    const response = withdrawSubmittedDraftResponseSchema.parse({ draft });
    dependencies.logger.info("Own pending submission withdrawn", {
      component: "drafts",
      draftId: response.draft.id,
      event: "own_draft_submission_withdrawn",
      userId: context.principal.userId,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerDraftWithdrawSubmissionRoute(
  routes: RouteRegistrar,
  options: RegisterDraftWithdrawSubmissionRouteOptions,
): void {
  routes.post(
    DRAFT_WITHDRAW_SUBMISSION_PATH,
    {
      authorization: options.authorization.require(DRAFT_HELP_ACCESS),
    },
    createDraftWithdrawSubmissionHandler(options),
  );
}
