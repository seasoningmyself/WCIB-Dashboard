import {
  MAX_POLICY_OVERRIDE_VALUES_BYTES,
  POLICY_OVERRIDE_FIELDS,
  type PolicyOverrideField,
} from "../../shared/policy-overrides.js";
import {
  projectAuditSummary,
  type AuditSummary,
} from "../audit/summary.js";

const moneyPattern = /^(0|[1-9][0-9]*)\.[0-9]{2}$/;
const commissionModes = new Set(["pct", "tbd", "na"]);
const allowedFields = new Set<string>(POLICY_OVERRIDE_FIELDS);

export interface PolicyOverrideValuePair {
  originalValues: AuditSummary;
  replacementValues: AuditSummary;
}

export function buildPolicyOverrideValuePair(
  originalSource: Readonly<Record<string, unknown>>,
  replacementSource: Readonly<Record<string, unknown>>,
  changedFields: readonly PolicyOverrideField[],
): PolicyOverrideValuePair {
  const fields = validateChangedFields(changedFields);
  const originalValues = projectOverrideValues(originalSource, fields);
  const replacementValues = projectOverrideValues(replacementSource, fields);

  for (const field of fields) {
    if (!(field in originalValues) || !(field in replacementValues)) {
      throw new Error(`Override field is missing: ${field}`);
    }
    if (originalValues[field] === replacementValues[field]) {
      throw new Error(`Override field did not change: ${field}`);
    }
  }

  for (const values of [originalValues, replacementValues]) {
    if (
      Buffer.byteLength(JSON.stringify(values), "utf8") >
      MAX_POLICY_OVERRIDE_VALUES_BYTES
    ) {
      throw new Error("Override values exceed the byte limit");
    }
  }

  return Object.freeze({ originalValues, replacementValues });
}

export function buildPolicyOverrideReplacement(
  replacementSource: Readonly<Record<string, unknown>>,
  changedFields: readonly PolicyOverrideField[],
): AuditSummary {
  return projectOverrideValues(
    replacementSource,
    validateChangedFields(changedFields),
  );
}

function validateChangedFields(
  changedFields: readonly PolicyOverrideField[],
): PolicyOverrideField[] {
  const fields = [...new Set(changedFields)];
  if (
    fields.length === 0 ||
    fields.length !== changedFields.length ||
    fields.some((field) => !allowedFields.has(field)) ||
    (fields.includes("commissionMode") && !fields.includes("commissionAmount"))
  ) {
    throw new Error("Override fields must be a unique non-empty allowlist");
  }
  return fields;
}

function projectOverrideValues(
  source: Readonly<Record<string, unknown>>,
  fields: readonly PolicyOverrideField[],
): AuditSummary {
  const values = projectAuditSummary(source, fields);
  for (const field of fields) {
    if (!(field in values)) {
      throw new Error(`Override field is missing: ${field}`);
    }
    validateOverrideValue(field, values[field]);
  }
  if (
    Buffer.byteLength(JSON.stringify(values), "utf8") >
    MAX_POLICY_OVERRIDE_VALUES_BYTES
  ) {
    throw new Error("Override values exceed the byte limit");
  }
  return values;
}

function validateOverrideValue(
  field: PolicyOverrideField,
  value: AuditSummary[string],
): void {
  if (typeof value !== "string") {
    throw new Error(`Override value must be a string: ${field}`);
  }
  if (field === "commissionMode") {
    if (!commissionModes.has(value)) {
      throw new Error("Override commission mode is invalid");
    }
    return;
  }
  if (!moneyPattern.test(value)) {
    throw new Error(`Override money must use two decimal places: ${field}`);
  }
}
