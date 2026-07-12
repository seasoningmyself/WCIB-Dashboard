import type { AccessRequirement } from "../auth/access.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { requireLifecycleAdmin } from "../policies/lifecycle.js";

export const APPROVAL_ADMIN_ACCESS = {
  capabilities: ["admin"],
} as const satisfies AccessRequirement;

export function requireApprovalAdmin(
  context: AuthorizedRequestContext,
): string {
  return requireLifecycleAdmin(context);
}
