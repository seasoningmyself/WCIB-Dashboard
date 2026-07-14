import type { RequestHandler } from "express";
import {
  paySheetBootstrapRequestSchema,
  paySheetBootstrapResponseSchema,
} from "../../shared/pay-sheet-api.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import { readDatabaseErrorCode } from "../db/error-code.js";
import type { AppLogger } from "../logging/logger.js";
import type { PaySheetInitializationResult } from "../pay-sheets/initialize.js";
import {
  projectAdminPaySheetSummary,
  type PaySheetSource,
} from "../pay-sheets/read.js";
import { POLICY_LEDGER_ADMIN_ACCESS } from "../policies/ledger-access.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const PAY_SHEET_BOOTSTRAP_PATH = "/api/pay-sheets/bootstrap";

export interface PaySheetBootstrapHandlerDependencies {
  bootstrap(
    context: AuthorizedRequestContext,
    input: unknown,
  ): Promise<PaySheetInitializationResult>;
  get(
    context: AuthorizedRequestContext,
    paySheetId: string,
  ): Promise<PaySheetSource>;
  logger: AppLogger;
}

export interface RegisterPaySheetBootstrapRouteOptions
  extends PaySheetBootstrapHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createPaySheetBootstrapHandler(
  dependencies: PaySheetBootstrapHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const input = paySheetBootstrapRequestSchema.parse(req.body);
    let initialization: PaySheetInitializationResult;
    try {
      initialization = await dependencies.bootstrap(context, input);
    } catch (error) {
      throw mapPaySheetBootstrapError(error);
    }
    const source = await dependencies.get(context, initialization.paySheetId);
    const sheet = projectAuthorizedFields(
      res,
      source,
      projectAdminPaySheetSummary,
    );
    if (sheet === null || sheet.ownerType !== "sophia") {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }
    const response = paySheetBootstrapResponseSchema.parse({
      created: initialization.created,
      sheet,
    });
    dependencies.logger.info("Pay-sheet bootstrap response returned", {
      actorUserId: context.principal.userId,
      component: "pay_sheets",
      created: response.created,
      event: "pay_sheet_bootstrap_response",
      paySheetId: response.sheet.id,
      periodMonth: response.sheet.periodMonth,
      periodYear: response.sheet.periodYear,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerPaySheetBootstrapRoute(
  routes: RouteRegistrar,
  options: RegisterPaySheetBootstrapRouteOptions,
): void {
  routes.post(
    PAY_SHEET_BOOTSTRAP_PATH,
    {
      authorization: options.authorization.require(
        POLICY_LEDGER_ADMIN_ACCESS,
      ),
    },
    createPaySheetBootstrapHandler(options),
  );
}

function mapPaySheetBootstrapError(error: unknown): unknown {
  const code = readDatabaseErrorCode(error);
  if (code === "42501") {
    return new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
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
      "Pay sheets are already initialized or unavailable",
    );
  }
  return error;
}
