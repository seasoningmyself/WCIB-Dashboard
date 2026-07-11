import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AppLogger, LogContext } from "../logging/logger.js";
import {
  buildTrustedAuditEvent,
  writeAuditEventInTransaction,
  type AuditQueryClient,
} from "./event.js";

function authorizedContext(
  userId = randomUUID(),
  userActive = true,
): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: ["admin"],
      staffRole: null,
      userActive,
      userId,
    },
  };
}

test("trusted audit events derive actor identity from authorization context", () => {
  const actorUserId = randomUUID();
  const forgedActorId = randomUUID();
  const input = {
    action: "policy_override_applied" as const,
    actorUserId: forgedActorId,
    after: {
      allowedFields: ["status"],
      source: { passwordHash: "hidden", status: "corrected" },
    },
    entityId: randomUUID(),
    entityType: "policy" as const,
  };

  const event = buildTrustedAuditEvent(authorizedContext(actorUserId), input);

  assert.equal(event.actorUserId, actorUserId);
  assert.notEqual(event.actorUserId, forgedActorId);
  assert.deepEqual(event.afterSummary, { status: "corrected" });
  assert.equal(JSON.stringify(event).includes("hidden"), false);
  assert.throws(
    () => buildTrustedAuditEvent(authorizedContext(actorUserId, false), input),
    /active authorized principal/,
  );
});

test("audit writer returns the database ID and logs only safe failure context", async () => {
  const eventId = randomUUID();
  const calls: unknown[][] = [];
  const client: AuditQueryClient = {
    async query<TResult>(_text: string, values?: unknown[]) {
      calls.push(values ?? []);
      return { rows: [{ event_id: eventId } as TResult] };
    },
  };
  const logger: AppLogger = {
    error() {},
    info() {},
    warn() {},
  };
  const input = {
    action: "producer_rate_changed" as const,
    after: {
      allowedFields: ["rateId"],
      source: { password: "hidden", rateId: randomUUID() },
    },
    entityId: randomUUID(),
    entityType: "producer_rate_history" as const,
  };

  assert.equal(
    await writeAuditEventInTransaction(
      client,
      authorizedContext(),
      input,
      logger,
    ),
    eventId,
  );
  assert.equal(JSON.stringify(calls).includes("hidden"), false);

  const logged: LogContext[] = [];
  const failingLogger: AppLogger = {
    error(_message, context) {
      logged.push(context ?? {});
    },
    info() {},
    warn() {},
  };
  const failingClient: AuditQueryClient = {
    async query() {
      throw new Error("database failure with private values");
    },
  };

  await assert.rejects(
    writeAuditEventInTransaction(
      failingClient,
      authorizedContext(),
      input,
      failingLogger,
    ),
    /database failure/,
  );
  assert.equal(logged.length, 1);
  assert.deepEqual(Object.keys(logged[0] ?? {}).sort(), [
    "action",
    "actorUserId",
    "component",
    "entityId",
    "entityType",
    "event",
  ]);
  assert.equal(JSON.stringify(logged).includes("hidden"), false);
  assert.equal(JSON.stringify(logged).includes("private"), false);
});
