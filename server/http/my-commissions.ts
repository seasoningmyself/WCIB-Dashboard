import type { RequestHandler, Response } from "express";
import {
  myCommissionsListQuerySchema,
  myCommissionReceiptParamsSchema,
  myCommissionReceiptRequestSchema,
  myCommissionsResponseSchema,
  type MyCommissionItem,
  type MyCommissionsSummary,
} from "../../shared/my-commissions.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import { MY_COMMISSIONS_ACCESS } from "../commissions/access.js";
import {
  projectProducerCommissionItem,
  projectProducerCommissionSummary,
  type ProducerCommissionItemSource,
  type ProducerCommissionSummarySource,
} from "../commissions/projection.js";
import {
  MyCommissionsBoundsError,
  type MyCommissionsSourceList,
} from "../commissions/read.js";
import {
  ProducerCommissionReceiptNotFoundError,
  type ProducerCommissionReceiptResult,
} from "../commissions/receipts.js";
import type { AppLogger } from "../logging/logger.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const MY_COMMISSIONS_PATH = "/api/my-commissions";
export const MY_COMMISSION_RECEIPT_PATH =
  "/api/my-commissions/:policyId/receipt";

export interface MyCommissionsHandlerDependencies {
  list(
    context: AuthorizedRequestContext,
    query: unknown,
  ): Promise<MyCommissionsSourceList>;
  logger: AppLogger;
}

export interface RegisterMyCommissionsRouteOptions
  extends MyCommissionsHandlerDependencies {
  authorization: AuthorizationGuards;
}

export interface MyCommissionReceiptHandlerDependencies {
  change(
    context: AuthorizedRequestContext,
    policyId: string,
    input: unknown,
  ): Promise<ProducerCommissionReceiptResult>;
}

export interface RegisterMyCommissionReceiptRouteOptions
  extends MyCommissionReceiptHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createMyCommissionsListHandler(
  dependencies: MyCommissionsHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const query = myCommissionsListQuerySchema.parse(req.query);
    let source: MyCommissionsSourceList;
    try {
      source = await dependencies.list(context, query);
    } catch (error) {
      if (error instanceof MyCommissionsBoundsError) {
        throw new HttpError(
          400,
          apiErrorCodes.badRequest,
          "My Commissions query is invalid",
        );
      }
      throw error;
    }
    const items = source.items.map((item) => projectItem(res, item));
    const summary = projectSummary(res, source.summary);
    const response = myCommissionsResponseSchema.parse({ items, summary });
    dependencies.logger.info("Producer commissions loaded", {
      component: "my_commissions",
      event: "my_commissions_read",
      inReviewCount: response.summary.inReviewCount,
      owedCount: response.summary.owedCount,
      paidLast30DaysCount: response.summary.paidLast30DaysCount,
      resultCount: response.items.length,
      userId: context.principal.userId,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerMyCommissionsRoute(
  routes: RouteRegistrar,
  options: RegisterMyCommissionsRouteOptions,
): void {
  routes.get(
    MY_COMMISSIONS_PATH,
    {
      authorization: options.authorization.require(MY_COMMISSIONS_ACCESS),
    },
    createMyCommissionsListHandler(options),
  );
}

export function createMyCommissionReceiptHandler(
  dependencies: MyCommissionReceiptHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { policyId } = myCommissionReceiptParamsSchema.parse(req.params);
    const input = myCommissionReceiptRequestSchema.parse(req.body);
    let result: ProducerCommissionReceiptResult;
    try {
      result = await dependencies.change(context, policyId, input);
    } catch (error) {
      if (error instanceof ProducerCommissionReceiptNotFoundError) {
        throw new HttpError(
          404,
          apiErrorCodes.notFound,
          "Commission item was not found",
        );
      }
      throw error;
    }
    const item = projectItem(res, result.source);
    res.set("Cache-Control", "no-store").json(item);
  });
}

export function registerMyCommissionReceiptRoute(
  routes: RouteRegistrar,
  options: RegisterMyCommissionReceiptRouteOptions,
): void {
  routes.put(
    MY_COMMISSION_RECEIPT_PATH,
    {
      authorization: options.authorization.require(MY_COMMISSIONS_ACCESS),
    },
    createMyCommissionReceiptHandler(options),
  );
}

function projectItem(
  res: Response,
  source: ProducerCommissionItemSource,
): MyCommissionItem {
  const projected = projectAuthorizedFields(
    res,
    source,
    projectProducerCommissionItem,
  );
  if (projected === null) {
    throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  return projected;
}

function projectSummary(
  res: Response,
  source: ProducerCommissionSummarySource,
): MyCommissionsSummary {
  const projected = projectAuthorizedFields(
    res,
    source,
    projectProducerCommissionSummary,
  );
  if (projected === null) {
    throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  return projected;
}
