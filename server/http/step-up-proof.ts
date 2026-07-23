import type { Request } from "express";
import { apiErrorCodes } from "../../shared/api-errors.js";
import type { StepUpProof } from "../auth/mfa-step-up.js";
import { HttpError } from "./errors.js";

export function readStepUpProof(
  request: Request,
  descriptor: StepUpProof["descriptor"],
): StepUpProof {
  const sessionVersion = request.session.sessionVersion;
  if (!Number.isInteger(sessionVersion) || (sessionVersion ?? -1) < 0) {
    throw new HttpError(
      401,
      apiErrorCodes.unauthorized,
      "Authentication required",
    );
  }
  return {
    descriptor,
    sessionId: request.sessionID,
    sessionVersion: sessionVersion as number,
    token: request.header("X-WCIB-Step-Up")?.trim() || undefined,
  };
}
