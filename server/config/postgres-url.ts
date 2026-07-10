export function readPostgresUrl(
  variableName: string,
  value: string | undefined,
): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${variableName} is required`);
  }

  const databaseUrl = value.trim();

  try {
    const parsed = new URL(databaseUrl);

    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new Error(
      `${variableName} must be a valid PostgreSQL connection string`,
    );
  }

  return databaseUrl;
}
