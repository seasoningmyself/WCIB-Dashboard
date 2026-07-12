import type { AccessRequirement } from "../auth/access.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";

export const MY_COMMISSIONS_ACCESS = {
  staffRoles: ["producer"],
} as const satisfies AccessRequirement;

export class MyCommissionsAccessDeniedError extends Error {
  constructor() {
    super("My Commissions access is denied");
    this.name = "MyCommissionsAccessDeniedError";
  }
}

export function requireProducerCommissionOwner(
  context: AuthorizedRequestContext,
): string {
  const { principal } = context;
  if (!principal.userActive || principal.staffRole !== "producer") {
    throw new MyCommissionsAccessDeniedError();
  }
  return principal.userId;
}
