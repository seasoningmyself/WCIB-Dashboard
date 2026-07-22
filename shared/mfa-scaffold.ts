import { z } from "zod";

// The legacy enum retains email so migration 0005 remains reversible. Email is
// not an active WCIB MFA method.
export const MFA_METHOD_TYPES = ["email", "totp", "webauthn"] as const;
export type MfaMethodType = (typeof MFA_METHOD_TYPES)[number];

export const ACTIVE_MFA_METHOD_TYPES = ["webauthn", "totp"] as const;
export type ActiveMfaMethodType = (typeof ACTIVE_MFA_METHOD_TYPES)[number];

export const FOUNDATION_MFA_ENFORCEMENT_ENABLED = false as const;
export const DEFAULT_ADMIN_MFA_ENFORCEMENT_ENABLED = false as const;

export const MFA_AUTHENTICATION_STATES = [
  "authenticated",
  "mfa_challenge",
  "mfa_enrollment",
  "mfa_recovery",
] as const;
export type MfaAuthenticationState =
  (typeof MFA_AUTHENTICATION_STATES)[number];

export const MFA_STEP_UP_ACTIONS = [
  "admin_staff_update",
  "temporary_password",
  "admin_capability_change",
  "mfa_disable",
  "mfa_reset",
] as const;
export type MfaStepUpAction = (typeof MFA_STEP_UP_ACTIONS)[number];

export const MFA_RECOVERY_CODE_COUNT = 10;
export const MFA_RECOVERY_CODE_WARNING_COUNTS = [3, 1, 0] as const;

export const mfaMethodLabelSchema = z.string().trim().min(1).max(100);

export const mfaMethodSummarySchema = z
  .object({
    createdAt: z.string().datetime(),
    id: z.string().uuid(),
    isPrimary: z.boolean(),
    label: mfaMethodLabelSchema,
    lastUsedAt: z.string().datetime().nullable(),
    methodType: z.enum(ACTIVE_MFA_METHOD_TYPES),
  })
  .strict();

export type MfaMethodSummary = z.output<typeof mfaMethodSummarySchema>;

export const mfaStateSchema = z
  .object({
    adminEnforcementEnabled: z.boolean(),
    adminRecommended: z.boolean(),
    enrolled: z.boolean(),
    enrollmentRequired: z.boolean(),
    methods: z.array(mfaMethodSummarySchema),
    recoveryCodesAcknowledged: z.boolean(),
    recoveryCodesRemaining: z.number().int().min(0).max(MFA_RECOVERY_CODE_COUNT),
  })
  .strict();

export type MfaState = z.output<typeof mfaStateSchema>;

export const mfaSettingsResponseSchema = z
  .object({ mfa: mfaStateSchema })
  .strict();

export const totpCodeSchema = z.string().trim().regex(/^\d{6}$/);

export const startTotpEnrollmentResponseSchema = z
  .object({
    expiresAt: z.string().datetime(),
    methodId: z.string().uuid(),
    otpauthUrl: z.string().url(),
    secret: z.string().min(16).max(256),
  })
  .strict();

export const startTotpEnrollmentRequestSchema = z
  .object({ label: mfaMethodLabelSchema })
  .strict();

export const confirmTotpEnrollmentRequestSchema = z
  .object({
    code: totpCodeSchema,
    methodId: z.string().uuid(),
  })
  .strict();

export const recoveryCodesResponseSchema = z
  .object({
    codes: z.array(z.string().min(20)).length(MFA_RECOVERY_CODE_COUNT),
    mfa: mfaStateSchema,
  })
  .strict();

export const acknowledgeRecoveryCodesRequestSchema = z
  .object({ saved: z.literal(true) })
  .strict();

export const mfaTotpChallengeRequestSchema = z
  .object({ code: totpCodeSchema })
  .strict();

export const mfaRecoveryChallengeRequestSchema = z
  .object({ code: z.string().trim().min(20).max(128) })
  .strict();

export const webAuthnCredentialRequestSchema = z
  .object({
    challengeId: z.string().uuid(),
    credential: z.record(z.unknown()),
    label: mfaMethodLabelSchema,
  })
  .strict();

export const webAuthnOptionsResponseSchema = z
  .object({
    challengeId: z.string().uuid(),
    expiresAt: z.string().datetime(),
    options: z.record(z.unknown()),
  })
  .strict();

export const mfaChallengeResultSchema = z
  .object({
    recoveryCodes: z.array(z.string().min(20)).optional(),
    userId: z.string().uuid(),
  })
  .strict();

const stepUpMutationSchema = z.record(z.unknown()).superRefine((value, ctx) => {
  if (JSON.stringify(value).length > 8_192) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Mutation is too large" });
  }
});

export const mfaStepUpDescriptorSchema = z
  .object({
    action: z.enum(MFA_STEP_UP_ACTIONS),
    mutation: stepUpMutationSchema,
    targetUserId: z.string().uuid(),
  })
  .strict();

export type MfaStepUpDescriptor = z.output<typeof mfaStepUpDescriptorSchema>;

export const mfaStepUpTotpRequestSchema = z
  .object({
    code: totpCodeSchema,
    currentPassword: z.string().min(1).max(1_024),
    descriptor: mfaStepUpDescriptorSchema,
  })
  .strict();

export const mfaStepUpWebAuthnStartRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(1_024),
    descriptor: mfaStepUpDescriptorSchema,
  })
  .strict();

export const mfaStepUpWebAuthnFinishRequestSchema = z
  .object({
    challengeId: z.string().uuid(),
    credential: z.record(z.unknown()),
    descriptor: mfaStepUpDescriptorSchema,
  })
  .strict();

export const mfaStepUpResponseSchema = z
  .object({
    expiresAt: z.string().datetime(),
    token: z.string().min(32).max(256),
  })
  .strict();

export const mfaMethodParamsSchema = z
  .object({ methodId: z.string().uuid() })
  .strict();

export const updateMfaMethodRequestSchema = z
  .object({ label: mfaMethodLabelSchema })
  .strict();

export function isMfaMethodType(value: unknown): value is MfaMethodType {
  return MFA_METHOD_TYPES.some((methodType) => methodType === value);
}

export function isActiveMfaMethodType(
  value: unknown,
): value is ActiveMfaMethodType {
  return ACTIVE_MFA_METHOD_TYPES.some((methodType) => methodType === value);
}
