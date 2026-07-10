import {
  MAX_AUDIT_SUMMARY_BYTES,
  MAX_AUDIT_SUMMARY_FIELDS,
  MAX_AUDIT_SUMMARY_STRING_LENGTH,
} from "../../shared/audit-events.js";

export type AuditSummaryValue = string | number | boolean | null;
export type AuditSummary = Readonly<Record<string, AuditSummaryValue>>;

const FORBIDDEN_AUDIT_FIELD =
  /(authorization|cookie|credential|password|secret|session|token)/i;

export function projectAuditSummary(
  source: Readonly<Record<string, unknown>>,
  allowedFields: readonly string[],
): AuditSummary {
  if (allowedFields.length > MAX_AUDIT_SUMMARY_FIELDS) {
    throw new Error("Audit summary allowlist exceeds the field limit");
  }

  const summary: Record<string, AuditSummaryValue> = {};

  for (const field of allowedFields) {
    if (FORBIDDEN_AUDIT_FIELD.test(field)) {
      throw new Error(`Audit summary field is forbidden: ${field}`);
    }

    const value = source[field];
    if (value === undefined) {
      continue;
    }
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      throw new Error(`Audit summary field must be scalar: ${field}`);
    }
    if (
      typeof value === "string" &&
      value.length > MAX_AUDIT_SUMMARY_STRING_LENGTH
    ) {
      throw new Error(`Audit summary field is too long: ${field}`);
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error(`Audit summary field must be finite: ${field}`);
    }

    summary[field] = value;
  }

  if (Buffer.byteLength(JSON.stringify(summary), "utf8") > MAX_AUDIT_SUMMARY_BYTES) {
    throw new Error("Audit summary exceeds the byte limit");
  }

  return Object.freeze(summary);
}
