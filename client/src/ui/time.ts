const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const relativeFormatter = new Intl.RelativeTimeFormat("en-US", {
  numeric: "auto",
});

export function formatAbsoluteTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatRelativeTime(
  value: string,
  now = new Date(),
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || Number.isNaN(now.getTime())) {
    return value;
  }
  const elapsed = date.getTime() - now.getTime();
  const absolute = Math.abs(elapsed);
  if (absolute < MINUTE_MS) return "just now";
  if (absolute < HOUR_MS) {
    return relativeFormatter.format(Math.round(elapsed / MINUTE_MS), "minute");
  }
  if (absolute < DAY_MS) {
    return relativeFormatter.format(Math.round(elapsed / HOUR_MS), "hour");
  }
  if (absolute < 30 * DAY_MS) {
    return relativeFormatter.format(Math.round(elapsed / DAY_MS), "day");
  }
  if (absolute < 365 * DAY_MS) {
    return relativeFormatter.format(Math.round(elapsed / (30 * DAY_MS)), "month");
  }
  return relativeFormatter.format(
    Math.round(elapsed / (365 * DAY_MS)),
    "year",
  );
}

export function ageInWholeDays(value: string, now = new Date()): number | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || Number.isNaN(now.getTime())) {
    return null;
  }
  return Math.max(
    0,
    Math.floor((now.getTime() - date.getTime()) / DAY_MS),
  );
}
