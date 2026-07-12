import type { AccessRequirement } from "../auth/access.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";

export const DRAFT_SELF_SERVICE_ACCESS = {
  capabilities: ["admin"],
  staffRoles: ["employee", "producer"],
} as const satisfies AccessRequirement;

export const DRAFT_HELP_ACCESS = {
  staffRoles: ["employee", "producer"],
} as const satisfies AccessRequirement;

export class DraftAccessDeniedError extends Error {
  constructor() {
    super("Draft access is denied");
    this.name = "DraftAccessDeniedError";
  }
}

export function requireDraftSelfServiceActor(
  context: AuthorizedRequestContext,
): string {
  const { principal } = context;
  const isAdmin = principal.capabilities.includes("admin");
  const isStaff =
    principal.staffRole === "employee" || principal.staffRole === "producer";
  if (!principal.userActive || (!isAdmin && !isStaff)) {
    throw new DraftAccessDeniedError();
  }
  return principal.userId;
}

export function requireDraftStaffActor(
  context: AuthorizedRequestContext,
): string {
  const { principal } = context;
  const isStaff =
    principal.staffRole === "employee" || principal.staffRole === "producer";
  if (!principal.userActive || !isStaff) {
    throw new DraftAccessDeniedError();
  }
  return principal.userId;
}
