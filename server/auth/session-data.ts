import "express-session";

declare module "express-session" {
  interface SessionData {
    sessionVersion?: number;
    userId?: string;
  }
}

export {};
