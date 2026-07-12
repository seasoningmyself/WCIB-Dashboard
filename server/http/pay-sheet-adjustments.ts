import type { RequestHandler, Response } from "express";
import {
  parsePaySheetAdjustmentForOwner,
  paySheetAdjustmentDeleteRequestSchema,
  paySheetAdjustmentMutationResponseSchema,
  paySheetAdjustmentParamsSchema,
  type PaySheetAdjustmentInput,
  type PaySheetAdjustmentMutation,
} from "../../shared/pay-sheet-adjustment-api.js";
import { paySheetParamsSchema } from "../../shared/pay-sheet-api.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import type { AppLogger } from "../logging/logger.js";
import {
  PaySheetAdjustmentNotFoundError,
  projectAdminPaySheetAdjustmentMutation,
  type PaySheetAdjustmentTarget,
} from "../pay-sheets/adjustment-target.js";
import type { PaySheetAdjustmentInput as ServiceAdjustmentInput } from "../pay-sheets/adjustments.js";
import {
  PaySheetNotFoundError,
  type PaySheetSource,
} from "../pay-sheets/read.js";
import { POLICY_LEDGER_ADMIN_ACCESS } from "../policies/ledger-access.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import { projectPaySheetDetail } from "./pay-sheets.js";
import type { RouteRegistrar } from "./routes.js";

export const PAY_SHEET_ADJUSTMENT_CREATE_PATH =
  "/api/pay-sheets/:paySheetId/adjustments";
export const PAY_SHEET_ADJUSTMENT_PATH =
  "/api/pay-sheet-adjustments/:adjustmentId";

export interface PaySheetAdjustmentHandlerDependencies {
  create(
    context: AuthorizedRequestContext,
    input: ServiceAdjustmentInput,
  ): Promise<string>;
  delete(
    context: AuthorizedRequestContext,
    adjustmentId: string,
  ): Promise<string>;
  getSheet(
    context: AuthorizedRequestContext,
    paySheetId: string,
  ): Promise<PaySheetSource>;
  getTarget(
    context: AuthorizedRequestContext,
    adjustmentId: string,
  ): Promise<PaySheetAdjustmentTarget>;
  logger: AppLogger;
  update(
    context: AuthorizedRequestContext,
    adjustmentId: string,
    input: ServiceAdjustmentInput,
  ): Promise<string>;
}

export interface RegisterPaySheetAdjustmentRoutesOptions
  extends PaySheetAdjustmentHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createPaySheetAdjustmentCreateHandler(
  dependencies: PaySheetAdjustmentHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { paySheetId } = paySheetParamsSchema.parse(req.params);
    const sheet = await loadOpenSheet(dependencies, context, paySheetId);
    const input = parsePaySheetAdjustmentForOwner(
      req.body,
      sheet.header.sheet.ownerType,
    );
    let adjustmentId: string;
    try {
      adjustmentId = await dependencies.create(
        context,
        toServiceInput(paySheetId, input),
      );
    } catch (error) {
      throw mapPaySheetAdjustmentError(error);
    }
    return respondWithMutation(
      dependencies,
      context,
      res,
      { action: "created", adjustmentId, paySheetId },
    );
  });
}

export function createPaySheetAdjustmentUpdateHandler(
  dependencies: PaySheetAdjustmentHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { adjustmentId } = paySheetAdjustmentParamsSchema.parse(req.params);
    const target = await loadOpenTarget(dependencies, context, adjustmentId);
    const input = parsePaySheetAdjustmentForOwner(req.body, target.ownerType);
    let returnedId: string;
    try {
      returnedId = await dependencies.update(
        context,
        adjustmentId,
        toServiceInput(target.paySheetId, input),
      );
    } catch (error) {
      throw mapPaySheetAdjustmentError(error);
    }
    return respondWithMutation(
      dependencies,
      context,
      res,
      {
        action: "updated",
        adjustmentId: returnedId,
        paySheetId: target.paySheetId,
      },
    );
  });
}

export function createPaySheetAdjustmentDeleteHandler(
  dependencies: PaySheetAdjustmentHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { adjustmentId } = paySheetAdjustmentParamsSchema.parse(req.params);
    paySheetAdjustmentDeleteRequestSchema.parse(req.body ?? {});
    const target = await loadOpenTarget(dependencies, context, adjustmentId);
    let returnedId: string;
    try {
      returnedId = await dependencies.delete(context, adjustmentId);
    } catch (error) {
      throw mapPaySheetAdjustmentError(error);
    }
    return respondWithMutation(
      dependencies,
      context,
      res,
      {
        action: "deleted",
        adjustmentId: returnedId,
        paySheetId: target.paySheetId,
      },
    );
  });
}

export function registerPaySheetAdjustmentRoutes(
  routes: RouteRegistrar,
  options: RegisterPaySheetAdjustmentRoutesOptions,
): void {
  const adminAccess = {
    authorization: options.authorization.require(POLICY_LEDGER_ADMIN_ACCESS),
  } as const;
  routes.post(
    PAY_SHEET_ADJUSTMENT_CREATE_PATH,
    adminAccess,
    createPaySheetAdjustmentCreateHandler(options),
  );
  routes.put(
    PAY_SHEET_ADJUSTMENT_PATH,
    adminAccess,
    createPaySheetAdjustmentUpdateHandler(options),
  );
  routes.delete(
    PAY_SHEET_ADJUSTMENT_PATH,
    adminAccess,
    createPaySheetAdjustmentDeleteHandler(options),
  );
}

async function loadOpenSheet(
  dependencies: PaySheetAdjustmentHandlerDependencies,
  context: AuthorizedRequestContext,
  paySheetId: string,
): Promise<PaySheetSource> {
  let sheet: PaySheetSource;
  try {
    sheet = await dependencies.getSheet(context, paySheetId);
  } catch (error) {
    if (error instanceof PaySheetNotFoundError) {
      throw new HttpError(404, apiErrorCodes.notFound, "Pay sheet not found");
    }
    throw error;
  }
  if (sheet.header.sheet.status !== "open") {
    throw new HttpError(
      409,
      apiErrorCodes.badRequest,
      "Closed pay sheets cannot be adjusted",
    );
  }
  return sheet;
}

async function loadOpenTarget(
  dependencies: PaySheetAdjustmentHandlerDependencies,
  context: AuthorizedRequestContext,
  adjustmentId: string,
): Promise<PaySheetAdjustmentTarget> {
  let target: PaySheetAdjustmentTarget;
  try {
    target = await dependencies.getTarget(context, adjustmentId);
  } catch (error) {
    if (error instanceof PaySheetAdjustmentNotFoundError) {
      throw new HttpError(
        404,
        apiErrorCodes.notFound,
        "Pay-sheet adjustment not found",
      );
    }
    throw error;
  }
  if (target.status !== "open") {
    throw new HttpError(
      409,
      apiErrorCodes.badRequest,
      "Closed pay sheets cannot be adjusted",
    );
  }
  return target;
}

async function respondWithMutation(
  dependencies: PaySheetAdjustmentHandlerDependencies,
  context: AuthorizedRequestContext,
  res: Response,
  mutation: PaySheetAdjustmentMutation,
): Promise<void> {
  const source = await dependencies.getSheet(context, mutation.paySheetId);
  const projectedMutation = projectAuthorizedFields(
    res,
    mutation,
    projectAdminPaySheetAdjustmentMutation,
  );
  if (projectedMutation === null) {
    throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  const response = paySheetAdjustmentMutationResponseSchema.parse({
    mutation: projectedMutation,
    sheet: projectPaySheetDetail(res, source),
  });
  dependencies.logger.info("Pay-sheet adjustment response returned", {
    action: response.mutation.action,
    actorUserId: context.principal.userId,
    adjustmentId: response.mutation.adjustmentId,
    component: "pay_sheets",
    event: "pay_sheet_adjustment_response",
    paySheetId: response.mutation.paySheetId,
  });
  res.set("Cache-Control", "no-store").json(response);
}

function toServiceInput(
  paySheetId: string,
  input: PaySheetAdjustmentInput,
): ServiceAdjustmentInput {
  return {
    accountBasis: input.accountBasis,
    adjustmentType: input.adjustmentType,
    brokerFeeDelta: input.brokerFeeDelta,
    commissionDelta: input.commissionDelta,
    effectiveDate: input.effectiveDate,
    incomeAmount: input.incomeAmount,
    insuredOrClientLabel: input.insuredOrClientLabel,
    paySheetId,
    payoutDelta: input.payoutDelta,
    policyTypeId: input.policyTypeId,
    producerUserId: input.producerUserId,
    reasonOrNote: input.reasonOrNote,
  };
}

function mapPaySheetAdjustmentError(error: unknown): unknown {
  const code = readDatabaseErrorCode(error);
  if (
    code === "23503" ||
    code === "23514" ||
    code === "40001" ||
    code === "55000" ||
    code === "P0002"
  ) {
    return new HttpError(
      409,
      apiErrorCodes.badRequest,
      "Pay-sheet adjustment cannot be changed",
    );
  }
  return error;
}
