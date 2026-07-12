import type { RequestHandler } from "express";
import { z } from "zod";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  myItemsResponseSchema,
  type MyItemsResponse,
} from "../../shared/my-items.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import { DRAFT_HELP_ACCESS } from "../drafts/access.js";
import { projectMyItemForAuthorizedContext } from "../drafts/my-items-projection.js";
import type { DraftRecord } from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const MY_ITEMS_PATH = "/api/my-items";

const myItemsQuerySchema = z.object({}).strict();

export interface MyItemsHandlerDependencies {
  list(context: AuthorizedRequestContext): Promise<readonly DraftRecord[]>;
  logger: AppLogger;
}

export interface RegisterMyItemsRouteOptions extends MyItemsHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createMyItemsHandler(
  dependencies: MyItemsHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    myItemsQuerySchema.parse(req.query);
    const records = await dependencies.list(context);
    const items = records.map((record) =>
      projectAuthorizedFields(
        res,
        record,
        projectMyItemForAuthorizedContext,
      ),
    );
    if (items.some((item) => item === null)) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }
    const response: MyItemsResponse = myItemsResponseSchema.parse({ items });
    dependencies.logger.info("Own item statuses loaded", {
      component: "drafts",
      count: response.items.length,
      event: "own_item_statuses_read",
      userId: context.principal.userId,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerMyItemsRoute(
  routes: RouteRegistrar,
  options: RegisterMyItemsRouteOptions,
): void {
  routes.get(
    MY_ITEMS_PATH,
    {
      authorization: options.authorization.require(DRAFT_HELP_ACCESS),
    },
    createMyItemsHandler(options),
  );
}
