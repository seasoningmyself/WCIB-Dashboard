import type { AccessRequirement } from "../auth/access.js";

export const DRAFT_SELF_SERVICE_ACCESS = {
  capabilities: ["admin"],
  staffRoles: ["employee", "producer"],
} as const satisfies AccessRequirement;
