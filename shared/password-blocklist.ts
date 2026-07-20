const BLOCKED_PASSWORDS = [
  "123456789012",
  "1234567890123456",
  "1q2w3e4r5t6y",
  "adminadmin",
  "administrator",
  "changemeplease",
  "correcthorsebatterystaple",
  "footballfootball",
  "iloveyou123",
  "letmeinletmein",
  "monkeymonkey",
  "password",
  "passwordpassword",
  "password123",
  "password1234",
  "password12345",
  "password123456",
  "princessprincess",
  "qwerty123456",
  "qwertyuiop12",
  "sunshinesunshine",
  "trustno1trustno1",
  "welcome12345",
  "welcomehome",
] as const;

const WCIB_PASSWORD_MARKERS = [
  "wcib",
  "wcibdashboard",
  "wcibinsurance",
  "westcoastinsurance",
  "westcoastinsurancebrokers",
  "westcoastisthebest",
] as const;

const blockedPasswords = new Set(BLOCKED_PASSWORDS.map(canonicalize));

export function isBlockedPassword(password: string): boolean {
  const canonical = canonicalize(password);
  const withoutTrailingDigits = canonical.replace(/[0-9]+$/u, "");
  const leetFolded = canonical
    .replaceAll("0", "o")
    .replaceAll("1", "i")
    .replaceAll("3", "e")
    .replaceAll("4", "a")
    .replaceAll("5", "s")
    .replaceAll("7", "t");

  if (
    blockedPasswords.has(canonical) ||
    blockedPasswords.has(withoutTrailingDigits) ||
    blockedPasswords.has(leetFolded)
  ) {
    return true;
  }

  return WCIB_PASSWORD_MARKERS.some(
    (marker) => canonical.includes(marker) || leetFolded.includes(marker),
  );
}

function canonicalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]/gu, "");
}
