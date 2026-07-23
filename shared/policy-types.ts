export const POLICY_TYPE_CLASSES = [
  "Personal",
  "Commercial",
  "Life-Health",
] as const;

export type PolicyTypeClass = (typeof POLICY_TYPE_CLASSES)[number];

export function policyTypeClassLabel(classTag: PolicyTypeClass): string {
  return classTag === "Life-Health" ? "Health" : classTag;
}

export function isPolicyTypeClass(value: unknown): value is PolicyTypeClass {
  return (
    typeof value === "string" &&
    POLICY_TYPE_CLASSES.some((classTag) => classTag === value)
  );
}
