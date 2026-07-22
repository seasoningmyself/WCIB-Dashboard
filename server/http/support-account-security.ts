import {
  adminAccountSecurityParamsSchema,
  resetAdminMfaRequestSchema,
} from "../../shared/admin-account-security.js";
import { apiErrorCodes } from "../../shared/api-errors.js";
import type { AccessRequirement } from "../auth/access.js";
import {
  getAuthorizedRequestContext,
  type AuthorizationGuards,
  type AuthorizedRequestContext,
} from "../auth/authorization.js";
import {
  MfaResetAccessDeniedError,
  MfaResetConflictError,
  MfaResetNotFoundError,
} from "../auth/mfa-reset.js";
import { StepUpRequiredError, type StepUpProof } from "../auth/mfa-step-up.js";
import { asyncRoute, HttpError } from "./errors.js";
import type { RouteRegistrar } from "./routes.js";
import { readStepUpProof } from "./step-up-proof.js";

export const SUPPORT_ACCOUNT_MFA_RESET_PATH =
  "/api/support/accounts/:userId/mfa-reset";

export const SUPPORT_ACCOUNT_SECURITY_ACCESS = {
  capabilities: ["support_engineer"],
} as const satisfies AccessRequirement;

export interface RegisterSupportAccountSecurityRoutesOptions {
  authorization: AuthorizationGuards;
  resetMfa(
    context: AuthorizedRequestContext,
    userId: string,
    input: unknown,
    proof: StepUpProof,
  ): Promise<void>;
}

export function registerSupportAccountSecurityRoutes(
  routes: RouteRegistrar,
  options: RegisterSupportAccountSecurityRoutesOptions,
): void {
  routes.post(
    SUPPORT_ACCOUNT_MFA_RESET_PATH,
    {
      authorization: options.authorization.require(
        SUPPORT_ACCOUNT_SECURITY_ACCESS,
      ),
    },
    asyncRoute(async (request, response) => {
      const context = getAuthorizedRequestContext(response);
      const { userId } = adminAccountSecurityParamsSchema.parse(request.params);
      const input = resetAdminMfaRequestSchema.parse(request.body);
      try {
        await options.resetMfa(
          context,
          userId,
          input,
          readStepUpProof(request, {
            action: "mfa_reset",
            mutation: input,
            targetUserId: userId,
          }),
        );
      } catch (error) {
        throw mapSupportMfaResetError(error);
      }
      response.status(204).end();
    }),
  );
}

function mapSupportMfaResetError(error: unknown): unknown {
  if (
    error instanceof MfaResetAccessDeniedError ||
    error instanceof StepUpRequiredError
  ) {
    return new HttpError(
      403,
      error instanceof StepUpRequiredError
        ? apiErrorCodes.stepUpRequired
        : apiErrorCodes.forbidden,
      error instanceof StepUpRequiredError ? "MFA step-up required" : "Forbidden",
    );
  }
  if (error instanceof MfaResetNotFoundError) {
    return new HttpError(404, apiErrorCodes.notFound, "Account was not found");
  }
  if (error instanceof MfaResetConflictError) {
    return new HttpError(409, apiErrorCodes.badRequest, error.message);
  }
  return error;
}
