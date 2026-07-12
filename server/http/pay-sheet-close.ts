import type { RequestHandler } from "express";
import {
  paySheetCloseRequestSchema,
  paySheetCloseResponseSchema,
  paySheetParamsSchema,
} from "../../shared/pay-sheet-api.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import type { AppLogger } from "../logging/logger.js";
import type { PaySheetCloseResult } from "../pay-sheets/close.js";
import {
  PaySheetNotFoundError,
  projectAdminPaySheetCloseResult,
  type PaySheetSource,
} from "../pay-sheets/read.js";
import { POLICY_LEDGER_ADMIN_ACCESS } from "../policies/ledger-access.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import {
  projectPaySheetDetail,
  projectPaySheetSummary,
} from "./pay-sheets.js";
import type { RouteRegistrar } from "./routes.js";

export const PAY_SHEET_CLOSE_PATH = "/api/pay-sheets/:paySheetId/close";

export interface PaySheetCloseHandlerDependencies {
  close(
    context: AuthorizedRequestContext,
    paySheetId: string,
  ): Promise<PaySheetCloseResult>;
  get(
    context: AuthorizedRequestContext,
    paySheetId: string,
  ): Promise<PaySheetSource>;
  logger: AppLogger;
}

export interface RegisterPaySheetCloseRouteOptions
  extends PaySheetCloseHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createPaySheetCloseHandler(
  dependencies: PaySheetCloseHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { paySheetId } = paySheetParamsSchema.parse(req.params);
    paySheetCloseRequestSchema.parse(req.body ?? {});

    let close: PaySheetCloseResult;
    try {
      close = await dependencies.close(context, paySheetId);
    } catch (error) {
      throw mapPaySheetCloseError(error);
    }

    let closedSource: PaySheetSource;
    let nextSource: PaySheetSource;
    try {
      [closedSource, nextSource] = await Promise.all([
        dependencies.get(context, paySheetId),
        dependencies.get(context, close.nextSheetId),
      ]);
    } catch (error) {
      if (error instanceof PaySheetNotFoundError) {
        throw new HttpError(
          409,
          apiErrorCodes.badRequest,
          "Pay-sheet close result is incomplete",
        );
      }
      throw error;
    }

    const projectedClose = projectAuthorizedFields(
      res,
      close,
      projectAdminPaySheetCloseResult,
    );
    if (projectedClose === null) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }
    const response = paySheetCloseResponseSchema.parse({
      close: projectedClose,
      closedSheet: projectPaySheetDetail(res, closedSource),
      nextSheet: projectPaySheetSummary(res, nextSource),
    });
    dependencies.logger.info("Pay-sheet close response returned", {
      actorUserId: context.principal.userId,
      closed: response.close.closed,
      component: "pay_sheets",
      event: "pay_sheet_close_response",
      nextSheetId: response.close.nextSheetId,
      ownerType: response.close.ownerType,
      paySheetId,
      policyCount: response.close.policyCount,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerPaySheetCloseRoute(
  routes: RouteRegistrar,
  options: RegisterPaySheetCloseRouteOptions,
): void {
  routes.post(
    PAY_SHEET_CLOSE_PATH,
    {
      authorization: options.authorization.require(
        POLICY_LEDGER_ADMIN_ACCESS,
      ),
    },
    createPaySheetCloseHandler(options),
  );
}

function mapPaySheetCloseError(error: unknown): unknown {
  const code = readDatabaseErrorCode(error);
  if (
    code === "23505" ||
    code === "23514" ||
    code === "40001" ||
    code === "55000" ||
    code === "P0002"
  ) {
    return new HttpError(
      409,
      apiErrorCodes.badRequest,
      "Pay sheet cannot be closed",
    );
  }
  return error;
}
