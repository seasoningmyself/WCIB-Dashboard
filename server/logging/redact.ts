const MAX_DEPTH = 5;
const MAX_ARRAY_LENGTH = 20;
const MAX_STRING_LENGTH = 500;

export const REDACTED_LOG_VALUE = "[REDACTED]";
const TRUNCATED_LOG_VALUE = "[TRUNCATED]";
const CIRCULAR_LOG_VALUE = "[CIRCULAR]";

const sensitiveNormalizedKeys = new Set([
  "apikey",
  "connectionstring",
  "databaseurl",
  "dateofbirth",
  "dob",
  "dsn",
  "firstname",
  "fullname",
  "ip",
  "lastname",
  "policyholder",
  "requestbody",
  "requestheaders",
  "socialsecuritynumber",
  "ssn",
  "username",
]);

const sensitiveKeyTokens = new Set([
  "address",
  "amount",
  "authorization",
  "balance",
  "body",
  "collected",
  "commission",
  "cookie",
  "cookies",
  "credential",
  "credentials",
  "currency",
  "email",
  "employee",
  "fee",
  "financial",
  "gross",
  "header",
  "headers",
  "insured",
  "name",
  "net",
  "password",
  "paid",
  "payment",
  "payroll",
  "phone",
  "premium",
  "producer",
  "rate",
  "remitted",
  "revenue",
  "secret",
  "session",
  "token",
  "total",
]);

const sensitiveAssignmentPattern =
  /\b(?:authorization|cookie|credentials?|database_url|email|password|phone|session_secret|token)\s*[:=]\s*[^\s,;]+/gi;
const bearerTokenPattern = /\bbearer\s+[^\s,;]+/gi;
const credentialUrlPattern =
  /\b(?:https?|mysql|postgres(?:ql)?|redis):\/\/[^\s/:@]+:[^\s/@]+@/gi;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phonePattern =
  /\b(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g;
const financialValuePattern =
  /\b(?:amount|balance|commission|fee|gross|net due|payroll|premium|rate|revenue|total)\b[^\n]*\d/i;

function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isSensitiveKey(key: string): boolean {
  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (sensitiveNormalizedKeys.has(normalizedKey)) {
    return true;
  }
  return keyTokens(key).some((token) => sensitiveKeyTokens.has(token));
}

function redactString(value: string): string {
  let redacted = value
    .replace(credentialUrlPattern, (match) => {
      const scheme = match.slice(0, match.indexOf("://") + 3);
      return `${scheme}${REDACTED_LOG_VALUE}@`;
    })
    .replace(bearerTokenPattern, `Bearer ${REDACTED_LOG_VALUE}`)
    .replace(sensitiveAssignmentPattern, REDACTED_LOG_VALUE)
    .replace(emailPattern, REDACTED_LOG_VALUE)
    .replace(phonePattern, REDACTED_LOG_VALUE);

  if (financialValuePattern.test(redacted)) {
    redacted = REDACTED_LOG_VALUE;
  }

  return redacted.length <= MAX_STRING_LENGTH
    ? redacted
    : `${redacted.slice(0, MAX_STRING_LENGTH)}${TRUNCATED_LOG_VALUE}`;
}

function errorName(error: Error): string {
  const name = redactString(error.name);
  return name === REDACTED_LOG_VALUE ? "Error" : name;
}

function redactValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return typeof value === "bigint" ? value.toString() : value;
  }

  if (typeof value !== "object") {
    return `[${typeof value}]`;
  }

  if (value instanceof Error) {
    return { name: errorName(value) };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return { byteLength: value.byteLength, type: "Buffer" };
  }

  if (depth >= MAX_DEPTH) {
    return TRUNCATED_LOG_VALUE;
  }

  if (seen.has(value)) {
    return CIRCULAR_LOG_VALUE;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const redacted = value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((item) => redactValue(item, depth + 1, seen));
    if (value.length > MAX_ARRAY_LENGTH) {
      redacted.push(TRUNCATED_LOG_VALUE);
    }
    return redacted;
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED_LOG_VALUE;
      continue;
    }

    try {
      result[key] = redactValue(
        (value as Record<string, unknown>)[key],
        depth + 1,
        seen,
      );
    } catch {
      result[key] = REDACTED_LOG_VALUE;
    }
  }
  return result;
}

export function redactLogValue(value: unknown): unknown {
  return redactValue(value, 0, new WeakSet());
}
