export const CSP_REPORT_PATH = "/api/security/csp-reports";

export const FRAME_ANCESTORS_POLICY = "frame-ancestors 'none'";

export const CSP_REPORT_ONLY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  FRAME_ANCESTORS_POLICY,
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'none'",
  "worker-src 'self'",
  "manifest-src 'self'",
  `report-uri ${CSP_REPORT_PATH}`,
  "report-to csp-endpoint",
].join("; ");

export const SECURITY_RESPONSE_HEADERS = Object.freeze({
  "Content-Security-Policy": FRAME_ANCESTORS_POLICY,
  "Content-Security-Policy-Report-Only": CSP_REPORT_ONLY_POLICY,
  "Referrer-Policy": "same-origin",
  "Reporting-Endpoints": `csp-endpoint=\"${CSP_REPORT_PATH}\"`,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});
