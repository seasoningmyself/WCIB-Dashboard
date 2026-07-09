const DEFAULT_PORT = 5000;

export function readPort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const port = Number(value);

  if (port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return port;
}
