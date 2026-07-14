import type { AccessRequirement } from "../auth/access.js";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import { requireDraftStaffActor } from "../drafts/access.js";
import { requirePolicyLedgerAdmin } from "../policies/ledger-access.js";

export const POLICY_CHANGE_REQUEST_OWNER_ACCESS = {
  staffRoles: ["employee", "producer"],
} as const satisfies AccessRequirement;

export const POLICY_CHANGE_REQUEST_ADMIN_ACCESS = {
  capabilities: ["admin"],
} as const satisfies AccessRequirement;

export function requirePolicyChangeRequestOwner(
  context: AuthorizedRequestContext,
): string {
  return requireDraftStaffActor(context);
}

export function requirePolicyChangeRequestAdmin(
  context: AuthorizedRequestContext,
): string {
  return requirePolicyLedgerAdmin(context);
}
