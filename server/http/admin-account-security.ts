import type { Request } from "express";
import {
  adminAccountSecurityListResponseSchema,
  adminAccountSecurityParamsSchema,
  resetAdminMfaRequestSchema,
  updateAdminAccountEmailRequestSchema,
  updateAdminCapabilityRequestSchema,
} from "../../shared/admin-account-security.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import {
  ADMIN_ACCOUNT_SECURITY_ACCESS,
  AdminAccountSecurityConflictError,
  AdminAccountSecurityNotFoundError,
} from "../auth/admin-account-security.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import { StepUpRequiredError, type StepUpProof } from "../auth/mfa-step-up.js";
import { projectAuthorizedFields } from "../security/field-projection.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";

export const ADMIN_ACCOUNT_SECURITY_PATH = "/api/admin/account-security";
export const ADMIN_ACCOUNT_SECURITY_CAPABILITY_PATH =
  "/api/admin/account-security/:userId/admin-capability";
export const ADMIN_ACCOUNT_SECURITY_EMAIL_PATH =
  "/api/admin/account-security/:userId/email";
export const ADMIN_ACCOUNT_SECURITY_MFA_RESET_PATH =
  "/api/admin/account-security/:userId/mfa-reset";

interface AccountSecuritySource {
  adminCapability: boolean;
  displayName: string;
  email: string;
  id: string;
  isActive: boolean;
  mfa: object;
  staffRole: string | null;
}

export interface RegisterAdminAccountSecurityRoutesOptions {
  authorization: AuthorizationGuards;
  list(context: AuthorizedRequestContext): Promise<AccountSecuritySource[]>;
  resetMfa(
    context: AuthorizedRequestContext,
    userId: string,
    input: unknown,
    proof: StepUpProof,
  ): Promise<void>;
  setAdminCapability(
    context: AuthorizedRequestContext,
    userId: string,
    input: unknown,
    proof: StepUpProof,
  ): Promise<void>;
  updateEmail(
    context: AuthorizedRequestContext,
    userId: string,
    input: unknown,
    proof: StepUpProof,
  ): Promise<void>;
}

export function registerAdminAccountSecurityRoutes(
  routes: RouteRegistrar,
  options: RegisterAdminAccountSecurityRoutesOptions,
): void {
  const access = {
    authorization: options.authorization.require(
      ADMIN_ACCOUNT_SECURITY_ACCESS,
    ),
  } as const;
  routes.get(
    ADMIN_ACCOUNT_SECURITY_PATH,
    access,
    asyncRoute(async (_req, res) => {
      const context = getAuthorizedRequestContext(res);
      const sources = await options.list(context);
      const projected = projectAuthorizedFields(
        res,
        { items: sources },
        (source) => adminAccountSecurityListResponseSchema.parse(source),
      );
      if (projected === null) {
        throw new HttpError(403, apiErrorCodes.forbidden, "Forbidden");
      }
      res.set("Cache-Control", "no-store").json(projected);
    }),
  );
  routes.patch(
    ADMIN_ACCOUNT_SECURITY_CAPABILITY_PATH,
    access,
    asyncRoute(async (req, res) => {
      const context = getAuthorizedRequestContext(res);
      const { userId } = adminAccountSecurityParamsSchema.parse(req.params);
      const input = updateAdminCapabilityRequestSchema.parse(req.body);
      await runMutation(() =>
        options.setAdminCapability(
          context,
          userId,
          input,
          stepUpProof(req, {
            action: "admin_capability_change",
            mutation: input,
            targetUserId: userId,
          }),
        ),
      );
      res.status(204).end();
    }),
  );
  routes.patch(
    ADMIN_ACCOUNT_SECURITY_EMAIL_PATH,
    access,
    asyncRoute(async (req, res) => {
      const context = getAuthorizedRequestContext(res);
      const { userId } = adminAccountSecurityParamsSchema.parse(req.params);
      const input = updateAdminAccountEmailRequestSchema.parse(req.body);
      await runMutation(() =>
        options.updateEmail(
          context,
          userId,
          input,
          stepUpProof(req, {
            action: "admin_staff_update",
            mutation: input,
            targetUserId: userId,
          }),
        ),
      );
      res.status(204).end();
    }),
  );
  routes.post(
    ADMIN_ACCOUNT_SECURITY_MFA_RESET_PATH,
    access,
    asyncRoute(async (req, res) => {
      const context = getAuthorizedRequestContext(res);
      const { userId } = adminAccountSecurityParamsSchema.parse(req.params);
      const input = resetAdminMfaRequestSchema.parse(req.body);
      await runMutation(() =>
        options.resetMfa(
          context,
          userId,
          input,
          stepUpProof(req, {
            action: "mfa_reset",
            mutation: input,
            targetUserId: userId,
          }),
        ),
      );
      res.status(204).end();
    }),
  );
}

function stepUpProof(
  req: Request,
  descriptor: StepUpProof["descriptor"],
): StepUpProof {
  const sessionVersion = req.session.sessionVersion;
  if (!Number.isInteger(sessionVersion) || (sessionVersion ?? -1) < 0) {
    throw new HttpError(401, apiErrorCodes.unauthorized, "Authentication required");
  }
  return {
    descriptor,
    sessionId: req.sessionID,
    sessionVersion: sessionVersion as number,
    token: req.header("X-WCIB-Step-Up")?.trim() || undefined,
  };
}

async function runMutation(mutate: () => Promise<void>): Promise<void> {
  try {
    await mutate();
  } catch (error) {
    if (error instanceof StepUpRequiredError) {
      throw new HttpError(
        403,
        apiErrorCodes.stepUpRequired,
        "MFA step-up required",
      );
    }
    if (error instanceof AdminAccountSecurityNotFoundError) {
      throw new HttpError(404, apiErrorCodes.notFound, "Account was not found");
    }
    if (error instanceof AdminAccountSecurityConflictError) {
      throw new HttpError(409, apiErrorCodes.badRequest, error.message);
    }
    throw error;
  }
}
