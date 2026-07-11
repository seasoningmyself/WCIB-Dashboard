import type { AccessRequirement } from "../auth/access.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { requireLifecycleAdmin } from "./lifecycle.js";

export const POLICY_LEDGER_ADMIN_ACCESS = {
  capabilities: ["admin"],
} as const satisfies AccessRequirement;

export function requirePolicyLedgerAdmin(
  context: AuthorizedRequestContext,
): string {
  return requireLifecycleAdmin(context);
}
