import { z } from "zod";
import {
  supportBackupSchema,
  type SupportBackup,
} from "../../shared/support-dashboard.js";
import type { DigitalOceanBackupConfig } from "../config/support.js";

export interface SupportBackupProvider {
  load(now: Date): Promise<SupportBackup>;
}

type Fetch = typeof fetch;

const backupListSchema = z
  .object({
    backups: z
      .array(
        z
          .object({
            created_at: z.string().datetime({ offset: true }),
          })
          .passthrough(),
      )
      .max(1_000),
  })
  .passthrough();

export function createDigitalOceanBackupProvider(
  config: DigitalOceanBackupConfig | null,
  freshnessThresholdHours: number,
  fetchImplementation: Fetch = fetch,
): SupportBackupProvider {
  if (config === null) {
    return {
      async load(now) {
        return unavailableBackup(now, freshnessThresholdHours);
      },
    };
  }
  return {
    async load(now) {
      const url = new URL(
        `${config.apiBaseUrl}/databases/${encodeURIComponent(
          config.databaseClusterId,
        )}/backups`,
      );
      const response = await fetchImplementation(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${config.apiToken}`,
        },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        throw new Error(
          `DigitalOcean backup request failed with status ${response.status}`,
        );
      }
      const payload = backupListSchema.parse(await response.json());
      const latest = payload.backups
        .map(({ created_at }) => created_at)
        .sort()
        .at(-1) ?? null;
      if (latest === null) {
        return supportBackupSchema.parse({
          ageSeconds: null,
          checkedAt: now.toISOString(),
          configured: true,
          freshnessThresholdHours,
          latestRecoveryPointAt: null,
          pointInTimeRecoveryEnabled:
            config.pointInTimeRecoveryEnabled,
          provider: "digitalocean",
          status: "unavailable",
        });
      }
      const ageSeconds = Math.max(
        0,
        Math.floor((now.getTime() - Date.parse(latest)) / 1_000),
      );
      return supportBackupSchema.parse({
        ageSeconds,
        checkedAt: now.toISOString(),
        configured: true,
        freshnessThresholdHours,
        latestRecoveryPointAt: latest,
        pointInTimeRecoveryEnabled: config.pointInTimeRecoveryEnabled,
        provider: "digitalocean",
        status:
          ageSeconds <= freshnessThresholdHours * 60 * 60 ? "fresh" : "stale",
      });
    },
  };
}

export function unavailableBackup(
  now: Date,
  freshnessThresholdHours: number,
): SupportBackup {
  return supportBackupSchema.parse({
    ageSeconds: null,
    checkedAt: now.toISOString(),
    configured: false,
    freshnessThresholdHours,
    latestRecoveryPointAt: null,
    pointInTimeRecoveryEnabled: null,
    provider: "digitalocean",
    status: "unavailable",
  });
}
