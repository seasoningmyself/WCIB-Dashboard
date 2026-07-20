import { createHmac } from "node:crypto";
import { and, eq, or, sql } from "drizzle-orm";
import type { AppLogger } from "../logging/logger.js";
import { loginThrottleBuckets } from "../db/schema.js";
import type { AuthDatabase } from "./users.js";

export type LoginThrottleKind = "account" | "ip";

export interface LoginThrottleKeys {
  account: string;
  ip: string;
}

export interface LoginThrottleDecision {
  kind: LoginThrottleKind;
  retryAfterSeconds: number;
}

export interface LoginThrottle {
  check(keys: LoginThrottleKeys): Promise<LoginThrottleDecision | null>;
  clearAccount(account: string): Promise<void>;
  recordFailure(keys: LoginThrottleKeys): Promise<LoginThrottleDecision | null>;
}

const DECAY_MS = 24 * 60 * 60 * 1_000;
const thresholds = {
  account: [5, 10, 15],
  ip: [20, 40, 60],
} as const;
const cooldownSeconds = [60, 5 * 60, 15 * 60] as const;

export function createDatabaseLoginThrottle(
  database: AuthDatabase,
  secret: string,
  logger: AppLogger,
  clock: () => Date = () => new Date(),
): LoginThrottle {
  return {
    async check(keys) {
      const now = clock();
      const hashes = hashKeys(keys, secret);
      const rows = await database
        .select({
          blockedUntil: loginThrottleBuckets.blockedUntil,
          kind: loginThrottleBuckets.kind,
          lastFailedAt: loginThrottleBuckets.lastFailedAt,
        })
        .from(loginThrottleBuckets)
        .where(
          or(
            and(
              eq(loginThrottleBuckets.kind, "account"),
              eq(loginThrottleBuckets.bucketHash, hashes.account),
            ),
            and(
              eq(loginThrottleBuckets.kind, "ip"),
              eq(loginThrottleBuckets.bucketHash, hashes.ip),
            ),
          ),
        );
      const decision = longestActiveCooldown(rows, now);
      if (decision !== null) {
        logThrottle(logger, "login_throttled", decision);
      }
      return decision;
    },

    async clearAccount(account) {
      await database
        .delete(loginThrottleBuckets)
        .where(
          and(
            eq(loginThrottleBuckets.kind, "account"),
            eq(
              loginThrottleBuckets.bucketHash,
              hashBucket("account", account, secret),
            ),
          ),
        );
    },

    async recordFailure(keys) {
      const now = clock();
      const hashes = hashKeys(keys, secret);
      const decisions = await database.transaction(async (transaction) => {
        const results: LoginThrottleDecision[] = [];
        for (const kind of ["account", "ip"] as const) {
          const decision = await recordBucketFailure(
            transaction as AuthDatabase,
            kind,
            hashes[kind],
            now,
          );
          if (decision !== null) {
            results.push(decision);
          }
        }
        return results;
      });
      const decision = longestDecision(decisions);
      if (decision !== null) {
        logThrottle(logger, "login_throttle_started", decision);
      }
      return decision;
    },
  };
}

export function throttleCooldownForFailureCount(
  kind: LoginThrottleKind,
  failureCount: number,
): number | null {
  const [first, second, sustained] = thresholds[kind];
  if (failureCount >= sustained) return cooldownSeconds[2];
  if (failureCount === second) return cooldownSeconds[1];
  if (failureCount === first) return cooldownSeconds[0];
  return null;
}

export function hasThrottleDecayed(lastFailedAt: Date, now: Date): boolean {
  return now.getTime() - lastFailedAt.getTime() >= DECAY_MS;
}

async function recordBucketFailure(
  database: AuthDatabase,
  kind: LoginThrottleKind,
  bucketHash: string,
  now: Date,
): Promise<LoginThrottleDecision | null> {
  await database.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${kind}:${bucketHash}`}, 0))`,
  );
  const [existing] = await database
    .select({
      failureCount: loginThrottleBuckets.failureCount,
      lastFailedAt: loginThrottleBuckets.lastFailedAt,
    })
    .from(loginThrottleBuckets)
    .where(
      and(
        eq(loginThrottleBuckets.kind, kind),
        eq(loginThrottleBuckets.bucketHash, bucketHash),
      ),
    )
    .for("update")
    .limit(1);
  const failureCount =
    existing === undefined || hasThrottleDecayed(existing.lastFailedAt, now)
      ? 1
      : existing.failureCount + 1;
  const seconds = throttleCooldownForFailureCount(kind, failureCount);
  const blockedUntil =
    seconds === null ? null : new Date(now.getTime() + seconds * 1_000);

  await database
    .insert(loginThrottleBuckets)
    .values({
      blockedUntil,
      bucketHash,
      failureCount,
      kind,
      lastFailedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: {
        blockedUntil,
        failureCount,
        lastFailedAt: now,
        updatedAt: now,
      },
      target: [loginThrottleBuckets.kind, loginThrottleBuckets.bucketHash],
    });

  return seconds === null ? null : { kind, retryAfterSeconds: seconds };
}

function hashKeys(
  keys: LoginThrottleKeys,
  secret: string,
): Record<LoginThrottleKind, string> {
  return {
    account: hashBucket("account", keys.account, secret),
    ip: hashBucket("ip", keys.ip, secret),
  };
}

function hashBucket(
  kind: LoginThrottleKind,
  value: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${kind}:${value}`)
    .digest("hex");
}

function longestActiveCooldown(
  rows: readonly {
    blockedUntil: Date | null;
    kind: string;
    lastFailedAt: Date;
  }[],
  now: Date,
): LoginThrottleDecision | null {
  const decisions: LoginThrottleDecision[] = rows.flatMap((row) => {
    if (
      (row.kind !== "account" && row.kind !== "ip") ||
      row.blockedUntil === null ||
      hasThrottleDecayed(row.lastFailedAt, now) ||
      row.blockedUntil <= now
    ) {
      return [];
    }
    return [{
      kind: row.kind,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((row.blockedUntil.getTime() - now.getTime()) / 1_000),
      ),
    }];
  });
  return longestDecision(decisions);
}

function longestDecision(
  decisions: readonly LoginThrottleDecision[],
): LoginThrottleDecision | null {
  return decisions.reduce<LoginThrottleDecision | null>(
    (longest, decision) =>
      longest === null || decision.retryAfterSeconds > longest.retryAfterSeconds
        ? decision
        : longest,
    null,
  );
}

function logThrottle(
  logger: AppLogger,
  event: "login_throttle_started" | "login_throttled",
  decision: LoginThrottleDecision,
): void {
  logger.warn("Login temporarily throttled", {
    component: "auth",
    event,
    kind: decision.kind,
    retryAfterSeconds: decision.retryAfterSeconds,
  });
}
