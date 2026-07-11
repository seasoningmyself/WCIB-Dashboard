import {
  MAX_POLICY_CORRECTION_BYTES,
  POLICY_CORRECTION_FIELDS,
  type PolicyCorrectionField,
} from "../../shared/policy-corrections.js";

const allowedFields = new Set<string>(POLICY_CORRECTION_FIELDS);

export function buildPolicyCorrectionReplacement(
  source: Readonly<Record<string, unknown>>,
  changedFields: readonly PolicyCorrectionField[],
): Readonly<Record<string, unknown>> {
  const fields = [...new Set(changedFields)];
  if (
    fields.length === 0 ||
    fields.length !== changedFields.length ||
    fields.some((field) => !allowedFields.has(field))
  ) {
    throw new Error("Correction fields must be a unique non-empty allowlist");
  }

  const replacement = Object.fromEntries(
    fields.map((field) => {
      if (!Object.hasOwn(source, field) || source[field] === undefined) {
        throw new Error(`Correction field is missing: ${field}`);
      }
      return [field, source[field]];
    }),
  );

  let serialized: string;
  try {
    serialized = JSON.stringify(replacement);
  } catch {
    throw new Error("Correction values must be JSON serializable");
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_POLICY_CORRECTION_BYTES) {
    throw new Error("Correction values exceed the byte limit");
  }

  return Object.freeze(JSON.parse(serialized) as Record<string, unknown>);
}
