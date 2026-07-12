import type { RequestHandler, Response } from "express";
import {
  paySheetDetailResponseSchema,
  paySheetListQuerySchema,
  paySheetListResponseSchema,
  paySheetParamsSchema,
  type PaySheetDetail,
  type PaySheetSummary,
} from "../../shared/pay-sheet-api.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import type { AppLogger } from "../logging/logger.js";
import {
  PaySheetBoundsError,
  PaySheetNotFoundError,
  projectAdminPaySheetDetail,
  projectAdminPaySheetSummary,
  type PaySheetSource,
  type PaySheetSourceList,
} from "../pay-sheets/read.js";
import { POLICY_LEDGER_ADMIN_ACCESS } from "../policies/ledger-access.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const PAY_SHEETS_PATH = "/api/pay-sheets";
export const PAY_SHEET_DETAIL_PATH = "/api/pay-sheets/:paySheetId";

export interface PaySheetReadHandlerDependencies {
  get(
    context: AuthorizedRequestContext,
    paySheetId: string,
  ): Promise<PaySheetSource>;
  list(
    context: AuthorizedRequestContext,
    query: unknown,
  ): Promise<PaySheetSourceList>;
  logger: AppLogger;
}

export interface RegisterPaySheetReadRoutesOptions
  extends PaySheetReadHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createPaySheetListHandler(
  dependencies: PaySheetReadHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const query = paySheetListQuerySchema.parse(req.query);
    let source: PaySheetSourceList;
    try {
      source = await dependencies.list(context, query);
    } catch (error) {
      if (error instanceof PaySheetBoundsError) {
        throw new HttpError(
          400,
          apiErrorCodes.badRequest,
          "Pay-sheet query is invalid",
        );
      }
      throw error;
    }
    const response = paySheetListResponseSchema.parse({
      items: source.items.map((item) => projectPaySheetSummary(res, item)),
      query: source.query,
    });
    dependencies.logger.info("Pay sheets loaded", {
      component: "pay_sheets",
      event: "pay_sheets_read",
      resultCount: response.items.length,
      userId: context.principal.userId,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function createPaySheetDetailHandler(
  dependencies: PaySheetReadHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { paySheetId } = paySheetParamsSchema.parse(req.params);
    let source: PaySheetSource;
    try {
      source = await dependencies.get(context, paySheetId);
    } catch (error) {
      if (error instanceof PaySheetNotFoundError) {
        throw new HttpError(
          404,
          apiErrorCodes.notFound,
          "Pay sheet was not found",
        );
      }
      throw error;
    }
    const sheet = projectPaySheetDetail(res, source);
    const response = paySheetDetailResponseSchema.parse({ sheet });
    dependencies.logger.info("Pay sheet loaded", {
      component: "pay_sheets",
      event: "pay_sheet_read",
      ownerType: sheet.ownerType,
      paySheetId,
      status: sheet.status,
      userId: context.principal.userId,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerPaySheetReadRoutes(
  routes: RouteRegistrar,
  options: RegisterPaySheetReadRoutesOptions,
): void {
  const adminAccess = {
    authorization: options.authorization.require(POLICY_LEDGER_ADMIN_ACCESS),
  } as const;
  routes.get(
    PAY_SHEETS_PATH,
    adminAccess,
    createPaySheetListHandler(options),
  );
  routes.get(
    PAY_SHEET_DETAIL_PATH,
    adminAccess,
    createPaySheetDetailHandler(options),
  );
}

export function projectPaySheetSummary(
  res: Response,
  source: PaySheetSource,
): PaySheetSummary {
  const projected = projectAuthorizedFields(
    res,
    source,
    projectAdminPaySheetSummary,
  );
  if (projected === null) {
    throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  return projected;
}

export function projectPaySheetDetail(
  res: Response,
  source: PaySheetSource,
): PaySheetDetail {
  const projected = projectAuthorizedFields(
    res,
    source,
    projectAdminPaySheetDetail,
  );
  if (projected === null) {
    throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  return projected;
}
