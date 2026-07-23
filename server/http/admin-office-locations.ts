import type { RequestHandler, Response } from "express";
import {
  adminOfficeManagementResponseSchema,
  adminOfficeParamsSchema,
  createAdminOfficeRequestSchema,
  renameAdminOfficeRequestSchema,
} from "../../shared/admin-office-locations.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import type { AppLogger } from "../logging/logger.js";
import {
  AdminOfficeAccessDeniedError,
  AdminOfficeBoundsError,
  AdminOfficeConflictError,
  AdminOfficeNotFoundError,
  OFFICE_MANAGEMENT_ACCESS,
  projectAdminOfficeManagementSource,
  type AdminOfficeManagementSource,
} from "../offices/admin.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const ADMIN_OFFICE_LOCATIONS_PATH = "/api/admin/office-locations";
export const ADMIN_OFFICE_LOCATION_PATH =
  "/api/admin/office-locations/:officeLocationId";
export const ADMIN_OFFICE_LOCATION_DEACTIVATE_PATH =
  "/api/admin/office-locations/:officeLocationId/deactivate";
export const ADMIN_OFFICE_LOCATION_REACTIVATE_PATH =
  "/api/admin/office-locations/:officeLocationId/reactivate";

export interface AdminOfficeHandlerDependencies {
  create(
    context: AuthorizedRequestContext,
    input: unknown,
  ): Promise<AdminOfficeManagementSource>;
  list(context: AuthorizedRequestContext): Promise<AdminOfficeManagementSource>;
  logger: AppLogger;
  rename(
    context: AuthorizedRequestContext,
    officeLocationId: string,
    input: unknown,
  ): Promise<AdminOfficeManagementSource>;
  setActive(
    context: AuthorizedRequestContext,
    officeLocationId: string,
    active: boolean,
  ): Promise<AdminOfficeManagementSource>;
}

export interface RegisterAdminOfficeRoutesOptions
  extends AdminOfficeHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createAdminOfficeListHandler(
  dependencies: AdminOfficeHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (_req, res) => {
    const context = getAuthorizedRequestContext(res);
    let source: AdminOfficeManagementSource;
    try {
      source = await dependencies.list(context);
    } catch (error) {
      throw mapAdminOfficeError(error);
    }
    const response = projectOfficeResponse(res, source);
    dependencies.logger.info("Office location management loaded", {
      activeCount: response.mode.activeCount,
      actorUserId: context.principal.userId,
      component: "admin_office_locations",
      event: "admin_office_locations_read",
      mode: response.mode.kind,
      resultCount: response.items.length,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function createAdminOfficeCreateHandler(
  dependencies: AdminOfficeHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const input = createAdminOfficeRequestSchema.parse(req.body);
    let source: AdminOfficeManagementSource;
    try {
      source = await dependencies.create(context, input);
    } catch (error) {
      throw mapAdminOfficeError(error);
    }
    res
      .status(201)
      .set("Cache-Control", "no-store")
      .json(projectOfficeResponse(res, source));
  });
}

export function createAdminOfficeRenameHandler(
  dependencies: AdminOfficeHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { officeLocationId } = adminOfficeParamsSchema.parse(req.params);
    const input = renameAdminOfficeRequestSchema.parse(req.body);
    let source: AdminOfficeManagementSource;
    try {
      source = await dependencies.rename(context, officeLocationId, input);
    } catch (error) {
      throw mapAdminOfficeError(error);
    }
    res
      .set("Cache-Control", "no-store")
      .json(projectOfficeResponse(res, source));
  });
}

export function createAdminOfficeActiveHandler(
  dependencies: AdminOfficeHandlerDependencies,
  active: boolean,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { officeLocationId } = adminOfficeParamsSchema.parse(req.params);
    let source: AdminOfficeManagementSource;
    try {
      source = await dependencies.setActive(context, officeLocationId, active);
    } catch (error) {
      throw mapAdminOfficeError(error);
    }
    res
      .set("Cache-Control", "no-store")
      .json(projectOfficeResponse(res, source));
  });
}

export function registerAdminOfficeRoutes(
  routes: RouteRegistrar,
  options: RegisterAdminOfficeRoutesOptions,
): void {
  const access = {
    authorization: options.authorization.require(OFFICE_MANAGEMENT_ACCESS),
  } as const;
  routes.get(
    ADMIN_OFFICE_LOCATIONS_PATH,
    access,
    createAdminOfficeListHandler(options),
  );
  routes.post(
    ADMIN_OFFICE_LOCATIONS_PATH,
    access,
    createAdminOfficeCreateHandler(options),
  );
  routes.patch(
    ADMIN_OFFICE_LOCATION_PATH,
    access,
    createAdminOfficeRenameHandler(options),
  );
  routes.post(
    ADMIN_OFFICE_LOCATION_DEACTIVATE_PATH,
    access,
    createAdminOfficeActiveHandler(options, false),
  );
  routes.post(
    ADMIN_OFFICE_LOCATION_REACTIVATE_PATH,
    access,
    createAdminOfficeActiveHandler(options, true),
  );
}

function projectOfficeResponse(
  response: Response,
  source: AdminOfficeManagementSource,
) {
  const projected = projectAuthorizedFields(
    response,
    source,
    projectAdminOfficeManagementSource,
  );
  if (projected === null) {
    throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  return adminOfficeManagementResponseSchema.parse(projected);
}

function mapAdminOfficeError(error: unknown): unknown {
  if (error instanceof AdminOfficeAccessDeniedError) {
    return new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  if (error instanceof AdminOfficeNotFoundError) {
    return new HttpError(404, apiErrorCodes.notFound, "Office location was not found");
  }
  if (error instanceof AdminOfficeConflictError) {
    return new HttpError(409, apiErrorCodes.badRequest, "Office location conflicts with existing data");
  }
  if (error instanceof AdminOfficeBoundsError) {
    return new HttpError(409, apiErrorCodes.badRequest, "Office location result is too large");
  }
  return error;
}
