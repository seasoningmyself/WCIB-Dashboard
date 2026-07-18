export type AccountAssignmentLabel = "book" | "house" | "none";

export function accountAssignmentLabel(
  assignment: AccountAssignmentLabel,
  producerDisplayName: string | null,
  bookNoun: "account" | "book" = "book",
): string {
  if (assignment === "none") return "Sophia's account";
  if (assignment === "house") {
    return producerDisplayName === null
      ? "1st-yr house"
      : `1st-yr house - ${producerDisplayName}`;
  }
  return producerDisplayName === null
    ? `Producer ${bookNoun}`
    : `${producerDisplayName}'s ${bookNoun}`;
}
