export const POLICY_TYPE_CLASSES = [
  "Personal",
  "Commercial",
  "Life-Health",
] as const;

export type PolicyTypeClass = (typeof POLICY_TYPE_CLASSES)[number];
