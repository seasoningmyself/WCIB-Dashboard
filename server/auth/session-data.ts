import "express-session";
import type { MfaAuthenticationState } from "../../shared/mfa-scaffold.js";

declare module "express-session" {
  interface SessionData {
    authenticationState?: MfaAuthenticationState;
    recoveryGrantId?: string;
    sessionVersion?: number;
    userId?: string;
  }
}

export {};
