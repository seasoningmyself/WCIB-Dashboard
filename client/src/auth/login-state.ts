import { AuthApiError, type AuthApiErrorKind } from "./api.js";

export type LoginErrorKind = AuthApiErrorKind;

export interface LoginFailureState {
  error: LoginErrorKind;
  password: "";
  retryAfterSeconds: number;
}

export interface SingleFlight {
  isPending(): boolean;
  run<T>(operation: () => Promise<T>): Promise<T> | null;
}

export function createSingleFlight(): SingleFlight {
  let pending = false;
  return {
    isPending: () => pending,
    run<T>(operation: () => Promise<T>): Promise<T> | null {
      if (pending) {
        return null;
      }
      pending = true;
      return operation().finally(() => {
        pending = false;
      });
    },
  };
}

export function loginFailureState(error: unknown): LoginFailureState {
  return {
    error: error instanceof AuthApiError ? error.kind : "server",
    password: "",
    retryAfterSeconds:
      error instanceof AuthApiError && error.kind === "throttled"
        ? (error.retryAfterSeconds ?? 60)
        : 0,
  };
}

export function loginErrorText(
  error: LoginErrorKind,
  retryAfterSeconds = 0,
): string {
  switch (error) {
    case "invalid_credentials":
      return "Email or password is incorrect.";
    case "network":
      return "WCIB could not be reached. Check your connection and try again.";
    case "validation":
      return "Enter a valid email address and your password.";
    case "throttled": {
      const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
      return `Too many attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
    }
    case "invalid_response":
    case "server":
      return "Sign-in is temporarily unavailable. Try again.";
  }
}
