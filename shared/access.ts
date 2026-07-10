export const STAFF_ROLES = ["employee", "producer"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ACCESS_CAPABILITIES = ["admin"] as const;
export type AccessCapability = (typeof ACCESS_CAPABILITIES)[number];

export function isStaffRole(value: unknown): value is StaffRole {
  return STAFF_ROLES.some((role) => role === value);
}

export function isAccessCapability(
  value: unknown,
): value is AccessCapability {
  return ACCESS_CAPABILITIES.some((capability) => capability === value);
}
