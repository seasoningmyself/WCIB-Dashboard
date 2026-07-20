import assert from "node:assert/strict";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { createDatabasePool } from "../db/client.js";
import { withDisposableMigratedDatabase } from "../db/disposable-database-test-helper.js";
import { loginThrottleBuckets } from "../db/schema.js";
import * as databaseSchema from "../db/schema.js";
import type { AppLogger, LogContext } from "../logging/logger.js";
import { createDatabaseLoginThrottle } from "./login-throttle.js";

const SECRET = "login-throttle-db-test-secret-at-least-32-characters";

test("database login throttles expire, decay, and retain only keyed hashes", async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for login throttle tests");

  await withDisposableMigratedDatabase(
    databaseUrl,
    "wcib_login_throttle",
    async (isolatedUrl) => {
      const pool = createDatabasePool(isolatedUrl);
      const database = drizzle(pool, { schema: databaseSchema });
      const events: Array<{ context?: LogContext; message: string }> = [];
      const logger: AppLogger = {
        error() {},
        info() {},
        warn(message, context) {
          events.push({ context, message });
        },
      };
      let now = new Date("2026-07-19T12:00:00.000Z");
      const throttle = createDatabaseLoginThrottle(
        database,
        SECRET,
        logger,
        () => now,
      );
      const keys = {
        account: "staff.member@example.test",
        ip: "198.51.100.24",
      };

      try {
        for (let attempt = 1; attempt <= 5; attempt += 1) {
          const decision = await throttle.recordFailure(keys);
          assert.deepEqual(
            decision,
            attempt === 5
              ? { kind: "account", retryAfterSeconds: 60 }
              : null,
          );
        }
        assert.deepEqual(await throttle.check(keys), {
          kind: "account",
          retryAfterSeconds: 60,
        });

        now = new Date(now.getTime() + 61_000);
        assert.equal(await throttle.check(keys), null);
        await throttle.clearAccount(keys.account);
        const accountRowsAfterSuccess = await database
          .select()
          .from(loginThrottleBuckets)
          .where(eq(loginThrottleBuckets.kind, "account"));
        const ipRowsAfterSuccess = await database
          .select()
          .from(loginThrottleBuckets)
          .where(eq(loginThrottleBuckets.kind, "ip"));
        assert.equal(accountRowsAfterSuccess.length, 0);
        assert.equal(ipRowsAfterSuccess[0]?.failureCount, 5);

        for (let attempt = 6; attempt <= 20; attempt += 1) {
          const decision = await throttle.recordFailure({
            account: `rotating-${attempt}@example.test`,
            ip: keys.ip,
          });
          if (attempt === 20) {
            assert.deepEqual(decision, { kind: "ip", retryAfterSeconds: 60 });
          }
        }
        now = new Date(now.getTime() + 61_000);
        assert.equal(await throttle.check(keys), null);

        now = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
        assert.equal(await throttle.recordFailure(keys), null);
        const rowsAfterDecay = await database
          .select({
            blockedUntil: loginThrottleBuckets.blockedUntil,
            bucketHash: loginThrottleBuckets.bucketHash,
            failureCount: loginThrottleBuckets.failureCount,
            kind: loginThrottleBuckets.kind,
          })
          .from(loginThrottleBuckets)
          .where(
            and(
              eq(loginThrottleBuckets.kind, "ip"),
              eq(loginThrottleBuckets.failureCount, 1),
            ),
          );
        assert.equal(rowsAfterDecay.length, 1);
        assert.equal(rowsAfterDecay[0]?.blockedUntil, null);
        assert.match(rowsAfterDecay[0]?.bucketHash ?? "", /^[0-9a-f]{64}$/);

        const serializedRows = JSON.stringify(
          await database.select().from(loginThrottleBuckets),
        );
        const serializedEvents = JSON.stringify(events);
        for (const rawIdentifier of [keys.account, keys.ip]) {
          assert.equal(serializedRows.includes(rawIdentifier), false);
          assert.equal(serializedEvents.includes(rawIdentifier), false);
        }
        assert.ok(
          events.some(
            ({ context }) => context?.event === "login_throttle_started",
          ),
        );
        assert.ok(
          events.some(({ context }) => context?.event === "login_throttled"),
        );
      } finally {
        await pool.end();
      }
    },
  );
});
