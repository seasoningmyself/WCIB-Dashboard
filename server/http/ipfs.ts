import type { RequestHandler } from "express";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  ipfsPriorFinancingQuerySchema,
  ipfsPriorFinancingResponseSchema,
} from "../../shared/ipfs.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import { DRAFT_SELF_SERVICE_ACCESS } from "../drafts/access.js";
import type { AppLogger } from "../logging/logger.js";
import type { IpfsPriorFinancingSource } from "../policies/ipfs-history.js";
import { projectIpfsPriorFinancing } from "../policies/ipfs-projection.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const IPFS_PRIOR_FINANCING_PATH = "/api/ipfs/prior-financing";

export interface IpfsPriorFinancingHandlerDependencies {
  find(
    context: AuthorizedRequestContext,
    insuredName: string,
  ): Promise<IpfsPriorFinancingSource>;
  logger: AppLogger;
}

export interface RegisterIpfsPriorFinancingRouteOptions
  extends IpfsPriorFinancingHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createIpfsPriorFinancingHandler(
  dependencies: IpfsPriorFinancingHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { insuredName } = ipfsPriorFinancingQuerySchema.parse(req.query);
    const source = await dependencies.find(context, insuredName);
    const projected = projectAuthorizedFields(
      res,
      source,
      projectIpfsPriorFinancing,
    );
    if (projected === null) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }
    const response = ipfsPriorFinancingResponseSchema.parse(projected);
    dependencies.logger.info("IPFS prior-financing history checked", {
      component: "ipfs",
      event: "ipfs_prior_financing_checked",
      priorFinancingFound: response.priorFinancing !== null,
      userId: context.principal.userId,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerIpfsPriorFinancingRoute(
  routes: RouteRegistrar,
  options: RegisterIpfsPriorFinancingRouteOptions,
): void {
  routes.get(
    IPFS_PRIOR_FINANCING_PATH,
    {
      authorization: options.authorization.require(DRAFT_SELF_SERVICE_ACCESS),
    },
    createIpfsPriorFinancingHandler(options),
  );
}
