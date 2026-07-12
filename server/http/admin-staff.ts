import type { RequestHandler, Response } from "express";
import {
  adminStaffListResponseSchema,
  adminStaffMutationResponseSchema,
  adminStaffParamsSchema,
  adminStaffRateParamsSchema,
  createAdminStaffRequestSchema,
  producerRateInputSchema,
  updateAdminStaffRequestSchema,
} from "../../shared/admin-staff.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import {
  ADMIN_STAFF_ACCESS,
  AdminStaffBoundsError,
  AdminStaffConflictError,
  AdminStaffNotFoundError,
  ProducerRateLockedError,
  projectAdminStaffSource,
} from "../auth/admin-staff.js";
import type { AppLogger } from "../logging/logger.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const ADMIN_STAFF_PATH = "/api/admin/staff";
export const ADMIN_STAFF_DETAIL_PATH = "/api/admin/staff/:userId";
export const ADMIN_STAFF_DEACTIVATE_PATH =
  "/api/admin/staff/:userId/deactivate";
export const ADMIN_STAFF_REACTIVATE_PATH =
  "/api/admin/staff/:userId/reactivate";
export const ADMIN_STAFF_RATES_PATH = "/api/admin/staff/:userId/rates";
export const ADMIN_STAFF_RATE_PATH =
  "/api/admin/staff/:userId/rates/:rateId";

interface AdminStaffSourceLike {
  account: object;
  profile: object;
  rates: readonly object[];
}

export interface AdminStaffHandlerDependencies {
  create(
    context: AuthorizedRequestContext,
    input: unknown,
  ): Promise<AdminStaffSourceLike>;
  createRate(
    context: AuthorizedRequestContext,
    userId: string,
    input: unknown,
  ): Promise<AdminStaffSourceLike>;
  get(
    context: AuthorizedRequestContext,
    userId: string,
  ): Promise<AdminStaffSourceLike>;
  list(context: AuthorizedRequestContext): Promise<AdminStaffSourceLike[]>;
  logger: AppLogger;
  setActive(
    context: AuthorizedRequestContext,
    userId: string,
    active: boolean,
  ): Promise<AdminStaffSourceLike>;
  update(
    context: AuthorizedRequestContext,
    userId: string,
    input: unknown,
  ): Promise<AdminStaffSourceLike>;
  updateRate(
    context: AuthorizedRequestContext,
    userId: string,
    rateId: string,
    input: unknown,
  ): Promise<AdminStaffSourceLike>;
}

export interface RegisterAdminStaffRoutesOptions
  extends AdminStaffHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createAdminStaffListHandler(
  dependencies: AdminStaffHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (_req, res) => {
    const context = getAuthorizedRequestContext(res);
    let sources: AdminStaffSourceLike[];
    try {
      sources = await dependencies.list(context);
    } catch (error) {
      throw mapAdminStaffError(error);
    }
    const response = adminStaffListResponseSchema.parse({
      items: sources.map((source) => projectStaff(res, source)),
    });
    dependencies.logger.info("Admin staff roster loaded", {
      actorUserId: context.principal.userId,
      component: "admin_staff",
      event: "admin_staff_roster_read",
      resultCount: response.items.length,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function createAdminStaffDetailHandler(
  dependencies: AdminStaffHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { userId } = adminStaffParamsSchema.parse(req.params);
    let source: AdminStaffSourceLike;
    try {
      source = await dependencies.get(context, userId);
    } catch (error) {
      throw mapAdminStaffError(error);
    }
    res
      .set("Cache-Control", "no-store")
      .json(adminStaffMutationResponseSchema.parse({ staff: projectStaff(res, source) }));
  });
}

export function createAdminStaffCreateHandler(
  dependencies: AdminStaffHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const input = createAdminStaffRequestSchema.parse(req.body);
    let source: AdminStaffSourceLike;
    try {
      source = await dependencies.create(context, input);
    } catch (error) {
      throw mapAdminStaffError(error);
    }
    res
      .status(201)
      .set("Cache-Control", "no-store")
      .json(adminStaffMutationResponseSchema.parse({ staff: projectStaff(res, source) }));
  });
}

export function createAdminStaffUpdateHandler(
  dependencies: AdminStaffHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { userId } = adminStaffParamsSchema.parse(req.params);
    const input = updateAdminStaffRequestSchema.parse(req.body);
    let source: AdminStaffSourceLike;
    try {
      source = await dependencies.update(context, userId, input);
    } catch (error) {
      throw mapAdminStaffError(error);
    }
    respondWithStaff(res, source);
  });
}

export function createAdminStaffActiveHandler(
  dependencies: AdminStaffHandlerDependencies,
  active: boolean,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { userId } = adminStaffParamsSchema.parse(req.params);
    let source: AdminStaffSourceLike;
    try {
      source = await dependencies.setActive(context, userId, active);
    } catch (error) {
      throw mapAdminStaffError(error);
    }
    respondWithStaff(res, source);
  });
}

export function createAdminStaffRateCreateHandler(
  dependencies: AdminStaffHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { userId } = adminStaffParamsSchema.parse(req.params);
    const input = producerRateInputSchema.parse(req.body);
    let source: AdminStaffSourceLike;
    try {
      source = await dependencies.createRate(context, userId, input);
    } catch (error) {
      throw mapAdminStaffError(error);
    }
    res
      .status(201)
      .set("Cache-Control", "no-store")
      .json(adminStaffMutationResponseSchema.parse({ staff: projectStaff(res, source) }));
  });
}

export function createAdminStaffRateUpdateHandler(
  dependencies: AdminStaffHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { rateId, userId } = adminStaffRateParamsSchema.parse(req.params);
    const input = producerRateInputSchema.parse(req.body);
    let source: AdminStaffSourceLike;
    try {
      source = await dependencies.updateRate(context, userId, rateId, input);
    } catch (error) {
      throw mapAdminStaffError(error);
    }
    respondWithStaff(res, source);
  });
}

export function registerAdminStaffRoutes(
  routes: RouteRegistrar,
  options: RegisterAdminStaffRoutesOptions,
): void {
  const access = {
    authorization: options.authorization.require(ADMIN_STAFF_ACCESS),
  } as const;
  routes.get(ADMIN_STAFF_PATH, access, createAdminStaffListHandler(options));
  routes.get(
    ADMIN_STAFF_DETAIL_PATH,
    access,
    createAdminStaffDetailHandler(options),
  );
  routes.post(
    ADMIN_STAFF_PATH,
    access,
    createAdminStaffCreateHandler(options),
  );
  routes.patch(
    ADMIN_STAFF_DETAIL_PATH,
    access,
    createAdminStaffUpdateHandler(options),
  );
  routes.post(
    ADMIN_STAFF_DEACTIVATE_PATH,
    access,
    createAdminStaffActiveHandler(options, false),
  );
  routes.post(
    ADMIN_STAFF_REACTIVATE_PATH,
    access,
    createAdminStaffActiveHandler(options, true),
  );
  routes.post(
    ADMIN_STAFF_RATES_PATH,
    access,
    createAdminStaffRateCreateHandler(options),
  );
  routes.patch(
    ADMIN_STAFF_RATE_PATH,
    access,
    createAdminStaffRateUpdateHandler(options),
  );
}

function projectStaff(
  res: Response,
  source: AdminStaffSourceLike,
) {
  const projected = projectAuthorizedFields(
    res,
    source as Parameters<typeof projectAdminStaffSource>[0],
    projectAdminStaffSource,
  );
  if (projected === null) {
    throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
  }
  return projected;
}

function respondWithStaff(
  res: Response,
  source: AdminStaffSourceLike,
): void {
  res
    .set("Cache-Control", "no-store")
    .json(adminStaffMutationResponseSchema.parse({ staff: projectStaff(res, source) }));
}

function mapAdminStaffError(error: unknown): unknown {
  if (error instanceof AdminStaffNotFoundError) {
    return new HttpError(404, apiErrorCodes.notFound, "Staff account was not found");
  }
  if (
    error instanceof AdminStaffConflictError ||
    error instanceof ProducerRateLockedError
  ) {
    return new HttpError(409, apiErrorCodes.badRequest, error.message);
  }
  if (error instanceof AdminStaffBoundsError) {
    return new HttpError(400, apiErrorCodes.badRequest, "Staff result is too large");
  }
  return error;
}
