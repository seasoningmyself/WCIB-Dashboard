import type { RequestHandler } from "express";
import { SECURITY_RESPONSE_HEADERS } from "../../shared/security-policy.js";

export function createSecurityHeadersMiddleware(): RequestHandler {
  return (_req, res, next) => {
    for (const [name, value] of Object.entries(SECURITY_RESPONSE_HEADERS)) {
      res.setHeader(name, value);
    }
    next();
  };
}
