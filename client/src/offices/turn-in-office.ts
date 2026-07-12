import type { ActiveVocabularyResponse } from "../../../shared/vocabulary.js";

export function normalizeTurnInOfficeSelection(
  vocabulary: ActiveVocabularyResponse,
  currentOfficeId: string | null,
): string | null {
  if (vocabulary.officeMode.kind === "unconfigured") {
    return null;
  }
  if (vocabulary.officeMode.kind === "single") {
    return vocabulary.officeMode.soleOfficeId;
  }
  return vocabulary.officeLocations.some(({ id }) => id === currentOfficeId)
    ? currentOfficeId
    : null;
}
