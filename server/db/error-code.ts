interface ErrorDetails {
  cause?: unknown;
  code?: unknown;
  errors?: unknown;
}

export function readDatabaseErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const details = error as ErrorDetails;

  if (typeof details.code === "string") {
    return details.code;
  }

  if (Array.isArray(details.errors)) {
    for (const nestedError of details.errors) {
      const nestedCode = readDatabaseErrorCode(nestedError);

      if (nestedCode !== undefined) {
        return nestedCode;
      }
    }
  }

  return readDatabaseErrorCode(details.cause);
}
