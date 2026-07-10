export const MFA_METHOD_TYPES = ["email", "totp", "webauthn"] as const;
export type MfaMethodType = (typeof MFA_METHOD_TYPES)[number];

export const FOUNDATION_MFA_ENFORCEMENT_ENABLED = false as const;

export function isMfaMethodType(value: unknown): value is MfaMethodType {
  return MFA_METHOD_TYPES.some((methodType) => methodType === value);
}
