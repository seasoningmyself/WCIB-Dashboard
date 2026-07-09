import "dotenv/config";

const DEFAULT_PORT = 5000;
const MINIMUM_SESSION_SECRET_LENGTH = 32;
const UNSAFE_PRODUCTION_SECRET =
  /(change[-_ ]?me|development|example|placeholder)/i;

export type NodeEnvironment = "development" | "test" | "production";

export interface AppConfig {
  readonly databaseUrl: string;
  readonly nodeEnv: NodeEnvironment;
  readonly port: number;
  readonly sessionSecret: string;
}

function readNodeEnvironment(value: string | undefined): NodeEnvironment {
  const nodeEnv = value ?? "development";

  if (
    nodeEnv !== "development" &&
    nodeEnv !== "test" &&
    nodeEnv !== "production"
  ) {
    throw new Error(
      "NODE_ENV must be one of development, test, or production",
    );
  }

  return nodeEnv;
}

function readPort(value: string | undefined): number {
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

function readDatabaseUrl(value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new Error("DATABASE_URL is required");
  }

  const databaseUrl = value.trim();

  try {
    const parsed = new URL(databaseUrl);

    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection string");
  }

  return databaseUrl;
}

function readSessionSecret(
  value: string | undefined,
  nodeEnv: NodeEnvironment,
): string {
  if (value === undefined || value.trim() === "") {
    throw new Error("SESSION_SECRET is required");
  }

  const sessionSecret = value.trim();

  if (sessionSecret.length < MINIMUM_SESSION_SECRET_LENGTH) {
    throw new Error("SESSION_SECRET must be at least 32 characters");
  }

  if (
    nodeEnv === "production" &&
    UNSAFE_PRODUCTION_SECRET.test(sessionSecret)
  ) {
    throw new Error("SESSION_SECRET must not use an example value in production");
  }

  return sessionSecret;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const nodeEnv = readNodeEnvironment(env.NODE_ENV);

  return Object.freeze({
    databaseUrl: readDatabaseUrl(env.DATABASE_URL),
    nodeEnv,
    port: readPort(env.PORT),
    sessionSecret: readSessionSecret(env.SESSION_SECRET, nodeEnv),
  });
}
