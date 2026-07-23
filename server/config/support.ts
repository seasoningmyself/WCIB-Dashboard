export interface SupportReleaseConfig {
  readonly deployedAt: string | null;
  readonly sha: string | null;
}

export interface SentrySupportConfig {
  readonly apiBaseUrl: string;
  readonly apiToken: string;
  readonly environment: string | null;
  readonly organizationSlug: string;
  readonly projectSlug: string;
  readonly uptimeMonitorId: string | null;
}

export interface DigitalOceanBackupConfig {
  readonly apiBaseUrl: string;
  readonly apiToken: string;
  readonly databaseClusterId: string;
  readonly pointInTimeRecoveryEnabled: boolean;
}

export interface SupportConfig {
  readonly backupFreshnessThresholdHours: number;
  readonly digitalOceanBackup: DigitalOceanBackupConfig | null;
  readonly release: SupportReleaseConfig;
  readonly sentry: SentrySupportConfig | null;
}

const SHA_PATTERN = /^[0-9a-f]{40,64}$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,99}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readSupportConfig(
  env: NodeJS.ProcessEnv,
): SupportConfig {
  return Object.freeze({
    backupFreshnessThresholdHours: readPositiveInteger(
      env.WCIB_BACKUP_FRESHNESS_HOURS,
      30,
      168,
      "WCIB_BACKUP_FRESHNESS_HOURS",
    ),
    digitalOceanBackup: readDigitalOceanBackupConfig(env),
    release: readReleaseConfig(env),
    sentry: readSentrySupportConfig(env),
  });
}

function readReleaseConfig(
  env: NodeJS.ProcessEnv,
): SupportReleaseConfig {
  const rawSha = optionalValue(env.WCIB_RELEASE_SHA);
  const sha = rawSha === null || rawSha === "unknown" ? null : rawSha;
  if (sha !== null && !SHA_PATTERN.test(sha)) {
    throw new Error("WCIB_RELEASE_SHA must be a full hexadecimal commit SHA");
  }
  const deployedAt = optionalValue(env.WCIB_DEPLOYED_AT);
  if (deployedAt !== null && Number.isNaN(Date.parse(deployedAt))) {
    throw new Error("WCIB_DEPLOYED_AT must be an ISO-8601 timestamp");
  }
  return Object.freeze({ deployedAt, sha });
}

function readSentrySupportConfig(
  env: NodeJS.ProcessEnv,
): SentrySupportConfig | null {
  const apiToken = optionalValue(env.SENTRY_API_TOKEN);
  const organizationSlug = optionalValue(env.SENTRY_ORG_SLUG);
  const projectSlug = optionalValue(env.SENTRY_PROJECT_SLUG);
  const supplied = [apiToken, organizationSlug, projectSlug].some(
    (value) => value !== null,
  );
  if (!supplied) return null;
  if (apiToken === null || organizationSlug === null || projectSlug === null) {
    throw new Error(
      "SENTRY_API_TOKEN, SENTRY_ORG_SLUG, and SENTRY_PROJECT_SLUG must be configured together",
    );
  }
  if (!SLUG_PATTERN.test(organizationSlug) || !SLUG_PATTERN.test(projectSlug)) {
    throw new Error("Sentry organization and project values must be slugs");
  }
  const uptimeMonitorId = optionalValue(env.SENTRY_UPTIME_MONITOR_ID);
  if (
    uptimeMonitorId !== null &&
    !/^[a-zA-Z0-9_-]{1,100}$/.test(uptimeMonitorId)
  ) {
    throw new Error("SENTRY_UPTIME_MONITOR_ID has an invalid format");
  }
  return Object.freeze({
    apiBaseUrl: readHttpsBaseUrl(
      env.SENTRY_API_BASE_URL,
      "https://sentry.io/api/0",
      "SENTRY_API_BASE_URL",
    ),
    apiToken,
    environment: optionalValue(env.SENTRY_ENVIRONMENT),
    organizationSlug,
    projectSlug,
    uptimeMonitorId,
  });
}

function readDigitalOceanBackupConfig(
  env: NodeJS.ProcessEnv,
): DigitalOceanBackupConfig | null {
  const apiToken = optionalValue(env.DIGITALOCEAN_SUPPORT_API_TOKEN);
  const databaseClusterId = optionalValue(env.DIGITALOCEAN_DATABASE_CLUSTER_ID);
  const pitr = optionalValue(env.DIGITALOCEAN_DATABASE_PITR_ENABLED);
  const supplied = [apiToken, databaseClusterId, pitr].some(
    (value) => value !== null,
  );
  if (!supplied) return null;
  if (apiToken === null || databaseClusterId === null || pitr === null) {
    throw new Error(
      "DIGITALOCEAN_SUPPORT_API_TOKEN, DIGITALOCEAN_DATABASE_CLUSTER_ID, and DIGITALOCEAN_DATABASE_PITR_ENABLED must be configured together",
    );
  }
  if (!UUID_PATTERN.test(databaseClusterId)) {
    throw new Error("DIGITALOCEAN_DATABASE_CLUSTER_ID must be a UUID");
  }
  return Object.freeze({
    apiBaseUrl: readHttpsBaseUrl(
      env.DIGITALOCEAN_API_BASE_URL,
      "https://api.digitalocean.com/v2",
      "DIGITALOCEAN_API_BASE_URL",
    ),
    apiToken,
    databaseClusterId,
    pointInTimeRecoveryEnabled: readBoolean(pitr),
  });
}

function optionalValue(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized === undefined || normalized === "" ? null : normalized;
}

function readBoolean(value: string): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("DIGITALOCEAN_DATABASE_PITR_ENABLED must be true or false");
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be between 1 and ${maximum}`);
  }
  return parsed;
}

function readHttpsBaseUrl(
  value: string | undefined,
  fallback: string,
  name: string,
): string {
  const parsed = new URL(optionalValue(value) ?? fallback);
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") {
    throw new Error(`${name} must be an HTTPS URL without credentials`);
  }
  return parsed.toString().replace(/\/$/, "");
}
