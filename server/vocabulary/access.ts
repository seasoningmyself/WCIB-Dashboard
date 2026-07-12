import type { AccessRequirement } from "../auth/access.js";

export const VOCABULARY_USER_ACCESS = {
  capabilities: ["admin"],
  staffRoles: ["employee", "producer"],
} as const satisfies AccessRequirement;
