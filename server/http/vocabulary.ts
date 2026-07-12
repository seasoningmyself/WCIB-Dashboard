import type { RequestHandler } from "express";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  activeVocabularyResponseSchema,
  carrierMutationResponseSchema,
  createCarrierRequestSchema,
  createMgaRequestSchema,
  createPolicyTypeRequestSchema,
  mgaMutationResponseSchema,
  policyTypeMutationResponseSchema,
  type CarrierMutationResponse,
  type MgaMutationResponse,
  type PolicyTypeMutationResponse,
} from "../../shared/vocabulary.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import type { AppLogger } from "../logging/logger.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import {
  projectActiveVocabulary,
  VOCABULARY_READ_ACCESS,
  type ActiveVocabularySource,
} from "../vocabulary/active.js";
import {
  projectCarrierMutation,
  projectPolicyTypeMutation,
} from "../vocabulary/create.js";
import { VOCABULARY_ADD_ACCESS } from "../vocabulary/add-rules.js";
import { projectMgaMutation } from "../vocabulary/mga-create.js";
import { MGA_ADD_ACCESS } from "../vocabulary/mgas.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const ACTIVE_VOCABULARY_PATH = "/api/vocabulary";
export const CREATE_CARRIER_PATH = "/api/vocabulary/carriers";
export const CREATE_MGA_PATH = "/api/vocabulary/mgas";
export const CREATE_POLICY_TYPE_PATH = "/api/vocabulary/policy-types";

export interface ActiveVocabularyHandlerDependencies {
  load(): Promise<ActiveVocabularySource>;
  logger: AppLogger;
}

export interface RegisterActiveVocabularyRouteOptions {
  authorization: AuthorizationGuards;
  load(): Promise<ActiveVocabularySource>;
  logger: AppLogger;
}

export interface VocabularyMutationHandlerDependencies {
  createCarrier(
    context: AuthorizedRequestContext,
    input: unknown,
  ): Promise<CarrierMutationResponse>;
  createPolicyType(
    context: AuthorizedRequestContext,
    input: unknown,
  ): Promise<PolicyTypeMutationResponse>;
}

export interface RegisterVocabularyMutationRoutesOptions
  extends VocabularyMutationHandlerDependencies {
  authorization: AuthorizationGuards;
}

export interface MgaMutationHandlerDependencies {
  createMga(
    context: AuthorizedRequestContext,
    input: unknown,
  ): Promise<MgaMutationResponse>;
}

export interface RegisterMgaMutationRouteOptions
  extends MgaMutationHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function createActiveVocabularyHandler(
  dependencies: ActiveVocabularyHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (_req, res) => {
    const source = await dependencies.load();
    const projected = projectAuthorizedFields(
      res,
      source,
      projectActiveVocabulary,
    );
    if (projected === null) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }

    const response = activeVocabularyResponseSchema.parse(projected);
    dependencies.logger.info("Active vocabulary loaded", {
      carrierCount: response.carriers.length,
      component: "vocabulary",
      event: "active_vocabulary_read",
      mgaCount: response.mgas.length,
      officeLocationCount: response.officeLocations.length,
      policyTypeCount: response.policyTypes.length,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function registerActiveVocabularyRoute(
  routes: RouteRegistrar,
  options: RegisterActiveVocabularyRouteOptions,
): void {
  routes.get(
    ACTIVE_VOCABULARY_PATH,
    {
      authorization: options.authorization.require(VOCABULARY_READ_ACCESS),
    },
    createActiveVocabularyHandler({
      load: options.load,
      logger: options.logger,
    }),
  );
}

export function createCarrierMutationHandler(
  dependencies: Pick<VocabularyMutationHandlerDependencies, "createCarrier">,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const request = createCarrierRequestSchema.parse(req.body);
    const result = await dependencies.createCarrier(context, request);
    const projected = projectAuthorizedFields(
      res,
      result,
      projectCarrierMutation,
    );
    if (projected === null) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }

    const response = carrierMutationResponseSchema.parse(projected);
    res
      .status(response.outcome === "created" ? 201 : 409)
      .set("Cache-Control", "no-store")
      .json(response);
  });
}

export function createPolicyTypeMutationHandler(
  dependencies: Pick<VocabularyMutationHandlerDependencies, "createPolicyType">,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const request = createPolicyTypeRequestSchema.parse(req.body);
    const result = await dependencies.createPolicyType(context, request);
    const projected = projectAuthorizedFields(
      res,
      result,
      projectPolicyTypeMutation,
    );
    if (projected === null) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }

    const response = policyTypeMutationResponseSchema.parse(projected);
    res
      .status(response.outcome === "created" ? 201 : 409)
      .set("Cache-Control", "no-store")
      .json(response);
  });
}

export function createMgaMutationHandler(
  dependencies: MgaMutationHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const request = createMgaRequestSchema.parse(req.body);
    const result = await dependencies.createMga(context, request);
    const projected = projectAuthorizedFields(
      res,
      result,
      projectMgaMutation,
    );
    if (projected === null) {
      throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
    }

    const response = mgaMutationResponseSchema.parse(projected);
    res
      .status(response.outcome === "created" ? 201 : 409)
      .set("Cache-Control", "no-store")
      .json(response);
  });
}

export function registerVocabularyMutationRoutes(
  routes: RouteRegistrar,
  options: RegisterVocabularyMutationRoutesOptions,
): void {
  const access = {
    authorization: options.authorization.require(VOCABULARY_ADD_ACCESS),
  } as const;
  routes.post(
    CREATE_CARRIER_PATH,
    access,
    createCarrierMutationHandler(options),
  );
  routes.post(
    CREATE_POLICY_TYPE_PATH,
    access,
    createPolicyTypeMutationHandler(options),
  );
}

export function registerMgaMutationRoute(
  routes: RouteRegistrar,
  options: RegisterMgaMutationRouteOptions,
): void {
  routes.post(
    CREATE_MGA_PATH,
    {
      authorization: options.authorization.require(MGA_ADD_ACCESS),
    },
    createMgaMutationHandler(options),
  );
}
