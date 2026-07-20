export const apiErrorCodes = {
  badRequest: "bad_request",
  forbidden: "forbidden",
  invalidCredentials: "invalid_credentials",
  invalidCurrentPassword: "invalid_current_password",
  invalidResetToken: "invalid_reset_token",
  internal: "internal_error",
  notFound: "not_found",
  passwordChangeRequired: "password_change_required",
  passwordReuse: "password_reuse",
  tooManyAttempts: "too_many_attempts",
  unauthorized: "unauthorized",
  validation: "validation_error",
} as const;

export type ApiErrorCode =
  (typeof apiErrorCodes)[keyof typeof apiErrorCodes];

export interface ApiErrorDetail {
  field: string;
  message: string;
}

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    details?: ApiErrorDetail[];
    message: string;
  };
}
