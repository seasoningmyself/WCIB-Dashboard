export const apiErrorCodes = {
  badRequest: "bad_request",
  invalidCredentials: "invalid_credentials",
  invalidResetToken: "invalid_reset_token",
  internal: "internal_error",
  notFound: "not_found",
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
