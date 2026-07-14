const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export function normalizePaySheetDateInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  const isoMatch = isoDatePattern.exec(raw);
  if (isoMatch !== null) {
    return validIsoDate(isoMatch[1]!, isoMatch[2]!, isoMatch[3]!);
  }

  const separated = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(raw);
  if (separated !== null) {
    return buildIsoDate(separated[1]!, separated[2]!, separated[3]!);
  }

  if (!/^\d{4,8}$/.test(raw)) return null;
  const parts = splitV15DigitDate(raw);
  return parts === null ? null : buildIsoDate(parts.month, parts.day, parts.year);
}

export function formatPaySheetDateInput(value: string): string {
  const normalized = normalizePaySheetDateInput(value);
  if (normalized === null) return value;
  const [year, month, day] = normalized.split("-");
  return `${month}/${day}/${year}`;
}

function splitV15DigitDate(
  raw: string,
): { day: string; month: string; year: string } | null {
  if (raw.length === 8) {
    return { day: raw.slice(2, 4), month: raw.slice(0, 2), year: raw.slice(4) };
  }
  if (raw.length === 7) {
    return { day: raw.slice(1, 3), month: raw.slice(0, 1), year: raw.slice(3) };
  }
  if (raw.length === 6) {
    const firstTwo = Number(raw.slice(0, 2));
    return firstTwo >= 1 && firstTwo <= 12
      ? { day: raw.slice(2, 4), month: raw.slice(0, 2), year: raw.slice(4) }
      : { day: raw.slice(1, 2), month: raw.slice(0, 1), year: raw.slice(2) };
  }
  if (raw.length === 5) {
    return { day: raw.slice(1, 3), month: raw.slice(0, 1), year: raw.slice(3) };
  }
  if (raw.length === 4) {
    return { day: raw.slice(1, 2), month: raw.slice(0, 1), year: raw.slice(2) };
  }
  return null;
}

function buildIsoDate(month: string, day: string, year: string): string | null {
  const fourDigitYear = year.length === 2 ? `20${year}` : year;
  return validIsoDate(
    fourDigitYear,
    month.padStart(2, "0"),
    day.padStart(2, "0"),
  );
}

function validIsoDate(year: string, month: string, day: string): string | null {
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (
    !Number.isInteger(yearNumber) ||
    yearNumber < 2000 ||
    yearNumber > 9999 ||
    monthNumber < 1 ||
    monthNumber > 12 ||
    dayNumber < 1 ||
    dayNumber > 31
  ) {
    return null;
  }
  const date = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber));
  if (
    date.getUTCFullYear() !== yearNumber ||
    date.getUTCMonth() !== monthNumber - 1 ||
    date.getUTCDate() !== dayNumber
  ) {
    return null;
  }
  return `${year}-${month}-${day}`;
}
