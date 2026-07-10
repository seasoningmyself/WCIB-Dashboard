import {
  isAccessCapability,
  isStaffRole,
  type AccessCapability,
  type StaffRole,
} from "../../shared/access.js";

export const accessDenialReasons = {
  defaultDeny: "default_deny",
  inactiveUser: "inactive_user",
  missingRequiredAccess: "missing_required_access",
} as const;

export type AccessDenialReason =
  (typeof accessDenialReasons)[keyof typeof accessDenialReasons];

export interface AccessSource {
  capabilities: ReadonlyArray<{
    capability: string;
    isActive: boolean;
  }>;
  staffProfile: {
    isActive: boolean;
    role: string;
  } | null;
  userActive: boolean;
  userId: string;
}

export interface AccessPrincipal {
  capabilities: readonly AccessCapability[];
  staffRole: StaffRole | null;
  userActive: boolean;
  userId: string;
}

export interface AccessRequirement {
  capabilities?: readonly AccessCapability[];
  staffRoles?: readonly StaffRole[];
}

export type AccessDecision =
  | { allowed: true }
  | { allowed: false; reason: AccessDenialReason };

export function buildAccessPrincipal(source: AccessSource): AccessPrincipal {
  if (!source.userActive) {
    return {
      capabilities: [],
      staffRole: null,
      userActive: false,
      userId: source.userId,
    };
  }

  const staffRole =
    source.staffProfile?.isActive === true &&
    isStaffRole(source.staffProfile.role)
      ? source.staffProfile.role
      : null;
  const capabilities = Array.from(
    new Set(
      source.capabilities
        .filter((entry) => entry.isActive)
        .map((entry) => entry.capability)
        .filter(isAccessCapability),
    ),
  );

  return {
    capabilities,
    staffRole,
    userActive: true,
    userId: source.userId,
  };
}

export function evaluateAccess(
  principal: AccessPrincipal,
  requirement: AccessRequirement,
): AccessDecision {
  if (!principal.userActive) {
    return { allowed: false, reason: accessDenialReasons.inactiveUser };
  }

  const staffRoles = requirement.staffRoles ?? [];
  const capabilities = requirement.capabilities ?? [];
  if (staffRoles.length === 0 && capabilities.length === 0) {
    return { allowed: false, reason: accessDenialReasons.defaultDeny };
  }

  const staffAllowed =
    principal.staffRole !== null && staffRoles.includes(principal.staffRole);
  const capabilityAllowed = capabilities.some((capability) =>
    principal.capabilities.includes(capability),
  );

  return staffAllowed || capabilityAllowed
    ? { allowed: true }
    : { allowed: false, reason: accessDenialReasons.missingRequiredAccess };
}
