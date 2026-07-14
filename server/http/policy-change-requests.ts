import type { RequestHandler } from "express";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  correctPolicyChangeRequestSchema,
  createPolicyChangeRequestResponseSchema,
  createPolicyChangeRequestSchema,
  listOwnPolicyChangeRequestsResponseSchema,
  policyChangeRequestCorrectionResponseSchema,
  policyChangeRequestParamsSchema,
  policyChangeRequestPolicyParamsSchema,
  policyChangeRequestResolutionResponseSchema,
  resolvePolicyChangeRequestAsIsSchema,
  sendBackPolicyChangeRequestSchema,
} from "../../shared/policy-change-requests.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import type { PolicyChangeRequestRecord } from "../db/schema.js";
import type { AppLogger } from "../logging/logger.js";
import {
  PolicyLedgerCorrectionNotFoundError,
  PolicyLedgerCorrectionStaleError,
  PolicyLedgerCorrectionValidationError,
} from "../policies/ledger-corrections.js";
import {
  POLICY_CHANGE_REQUEST_ADMIN_ACCESS,
  POLICY_CHANGE_REQUEST_OWNER_ACCESS,
} from "../policy-change-requests/access.js";
import {
  projectAdminPolicyChangeRequest,
  projectOwnerPolicyChangeRequest,
  type AdminPolicyChangeRequestSource,
} from "../policy-change-requests/projection.js";
import {
  PolicyChangeRequestAccessDeniedError,
  PolicyChangeRequestNotFoundError,
  PolicyChangeRequestStateError,
  PolicyChangeRequestValidationError,
  type CorrectPolicyChangeRequestResult,
} from "../policy-change-requests/service.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const CREATE_POLICY_CHANGE_REQUEST_PATH =
  "/api/policies/:policyId/change-requests";
export const MY_POLICY_CHANGE_REQUESTS_PATH =
  "/api/policy-change-requests/mine";
export const CORRECT_POLICY_CHANGE_REQUEST_PATH =
  "/api/policy-change-requests/:requestId/correction";
export const RESOLVE_POLICY_CHANGE_REQUEST_AS_IS_PATH =
  "/api/policy-change-requests/:requestId/resolve-as-is";
export const SEND_BACK_POLICY_CHANGE_REQUEST_PATH =
  "/api/policy-change-requests/:requestId/send-back";

export interface PolicyChangeRequestHandlerDependencies {
  correct(
    context: AuthorizedRequestContext,
    requestId: string,
    input: unknown,
  ): Promise<CorrectPolicyChangeRequestResult>;
  create(
    context: AuthorizedRequestContext,
    policyId: string,
    input: unknown,
  ): Promise<PolicyChangeRequestRecord>;
  listMine(
    context: AuthorizedRequestContext,
  ): Promise<readonly PolicyChangeRequestRecord[]>;
  logger: AppLogger;
  resolveAsIs(
    context: AuthorizedRequestContext,
    requestId: string,
  ): Promise<AdminPolicyChangeRequestSource>;
  sendBack(
    context: AuthorizedRequestContext,
    requestId: string,
    input: unknown,
  ): Promise<AdminPolicyChangeRequestSource>;
}

export interface RegisterPolicyChangeRequestRoutesOptions
  extends PolicyChangeRequestHandlerDependencies {
  authorization: AuthorizationGuards;
}

export function registerPolicyChangeRequestRoutes(
  routes: RouteRegistrar,
  options: RegisterPolicyChangeRequestRoutesOptions,
): void {
  const ownerAccess = {
    authorization: options.authorization.require(
      POLICY_CHANGE_REQUEST_OWNER_ACCESS,
    ),
  };
  const adminAccess = {
    authorization: options.authorization.require(
      POLICY_CHANGE_REQUEST_ADMIN_ACCESS,
    ),
  };
  routes.post(
    CREATE_POLICY_CHANGE_REQUEST_PATH,
    ownerAccess,
    createPolicyChangeRequestHandler(options),
  );
  routes.get(
    MY_POLICY_CHANGE_REQUESTS_PATH,
    ownerAccess,
    createMyPolicyChangeRequestsHandler(options),
  );
  routes.patch(
    CORRECT_POLICY_CHANGE_REQUEST_PATH,
    adminAccess,
    createCorrectPolicyChangeRequestHandler(options),
  );
  routes.post(
    RESOLVE_POLICY_CHANGE_REQUEST_AS_IS_PATH,
    adminAccess,
    createResolvePolicyChangeRequestAsIsHandler(options),
  );
  routes.post(
    SEND_BACK_POLICY_CHANGE_REQUEST_PATH,
    adminAccess,
    createSendBackPolicyChangeRequestHandler(options),
  );
}

export function createPolicyChangeRequestHandler(
  dependencies: PolicyChangeRequestHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { policyId } = policyChangeRequestPolicyParamsSchema.parse(req.params);
    const input = createPolicyChangeRequestSchema.parse(req.body);
    let record: PolicyChangeRequestRecord;
    try {
      record = await dependencies.create(context, policyId, input);
    } catch (error) {
      throw mapPolicyChangeRequestError(error);
    }
    const request = projectAuthorizedFields(
      res,
      record,
      projectOwnerPolicyChangeRequest,
    );
    if (request === null) throw forbidden();
    const response = createPolicyChangeRequestResponseSchema.parse({ request });
    res.status(201).set("Cache-Control", "no-store").json(response);
  });
}

export function createMyPolicyChangeRequestsHandler(
  dependencies: PolicyChangeRequestHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (_req, res) => {
    const context = getAuthorizedRequestContext(res);
    const records = await dependencies.listMine(context);
    const requests = records.map((record) =>
      projectAuthorizedFields(res, record, projectOwnerPolicyChangeRequest),
    );
    if (requests.some((request) => request === null)) throw forbidden();
    const response = listOwnPolicyChangeRequestsResponseSchema.parse({
      requests,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function createCorrectPolicyChangeRequestHandler(
  dependencies: PolicyChangeRequestHandlerDependencies,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { requestId } = policyChangeRequestParamsSchema.parse(req.params);
    const input = correctPolicyChangeRequestSchema.parse(req.body);
    let result: CorrectPolicyChangeRequestResult;
    try {
      result = await dependencies.correct(context, requestId, input);
    } catch (error) {
      throw mapPolicyChangeRequestError(error);
    }
    const request = projectAuthorizedFields(
      res,
      result.source,
      projectAdminPolicyChangeRequest,
    );
    if (request === null) throw forbidden();
    const response = policyChangeRequestCorrectionResponseSchema.parse({
      policyId: result.policy.id,
      request,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

export function createResolvePolicyChangeRequestAsIsHandler(
  dependencies: PolicyChangeRequestHandlerDependencies,
): RequestHandler {
  return createAdminResolutionHandler(
    dependencies,
    (req) => resolvePolicyChangeRequestAsIsSchema.parse(req.body ?? {}),
    (context, requestId) => dependencies.resolveAsIs(context, requestId),
  );
}

export function createSendBackPolicyChangeRequestHandler(
  dependencies: PolicyChangeRequestHandlerDependencies,
): RequestHandler {
  return createAdminResolutionHandler(
    dependencies,
    (req) => sendBackPolicyChangeRequestSchema.parse(req.body),
    (context, requestId, input) =>
      dependencies.sendBack(context, requestId, input),
  );
}

function createAdminResolutionHandler<TInput>(
  _dependencies: PolicyChangeRequestHandlerDependencies,
  parse: (req: Parameters<RequestHandler>[0]) => TInput,
  run: (
    context: AuthorizedRequestContext,
    requestId: string,
    input: TInput,
  ) => Promise<AdminPolicyChangeRequestSource>,
): RequestHandler {
  return asyncRoute(async (req, res) => {
    const context = getAuthorizedRequestContext(res);
    const { requestId } = policyChangeRequestParamsSchema.parse(req.params);
    const input = parse(req);
    let source: AdminPolicyChangeRequestSource;
    try {
      source = await run(context, requestId, input);
    } catch (error) {
      throw mapPolicyChangeRequestError(error);
    }
    const request = projectAuthorizedFields(
      res,
      source,
      projectAdminPolicyChangeRequest,
    );
    if (request === null) throw forbidden();
    const response = policyChangeRequestResolutionResponseSchema.parse({
      request,
    });
    res.set("Cache-Control", "no-store").json(response);
  });
}

function mapPolicyChangeRequestError(error: unknown): unknown {
  if (
    error instanceof PolicyChangeRequestNotFoundError ||
    error instanceof PolicyLedgerCorrectionNotFoundError
  ) {
    return new HttpError(404, apiErrorCodes.notFound, "Change request not found");
  }
  if (error instanceof PolicyChangeRequestAccessDeniedError) {
    return forbidden();
  }
  if (error instanceof PolicyChangeRequestStateError) {
    return new HttpError(
      409,
      apiErrorCodes.badRequest,
      "Change request is no longer pending",
    );
  }
  if (error instanceof PolicyLedgerCorrectionStaleError) {
    return new HttpError(
      409,
      apiErrorCodes.badRequest,
      "Policy changed while the request was open",
    );
  }
  if (
    error instanceof PolicyChangeRequestValidationError ||
    error instanceof PolicyLedgerCorrectionValidationError
  ) {
    return new HttpError(
      400,
      apiErrorCodes.badRequest,
      "Change request is invalid",
    );
  }
  return error;
}

function forbidden(): HttpError {
  return new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
}
