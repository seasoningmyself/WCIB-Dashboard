import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuthorizedRequestContext } from "../auth/authorization.js";
import type { AuthDatabase } from "../auth/users.js";
import type { AppLogger, LogContext } from "../logging/logger.js";
import type { MgaPayableSourceItem } from "./mga-payables.js";
import {
  changeMgaPayableState,
  MgaPayableStateConflictError,
  type MgaPayableStateOperations,
} from "./mga-payable-state.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const POLICY_ID = "00000000-0000-4000-8000-000000000002";
const SHEET_ID = "00000000-0000-4000-8000-000000000003";

test("MGA payable coordinator runs state then placement with one transaction timestamp", async () => {
  const events: string[] = [];
  const timestamps: Date[] = [];
  const transaction = {} as never;
  const database = fakeDatabase(events, transaction);
  const operations: MgaPayableStateOperations = {
    async get(executor, context, policyId) {
      assert.equal(executor, transaction);
      assert.equal(context.principal.userId, ADMIN_ID);
      assert.equal(policyId, POLICY_ID);
      events.push("get");
      return { policy: { id: POLICY_ID } } as MgaPayableSourceItem;
    },
    async set(executor, context, policyId, input, _logger, changedAt) {
      assert.equal(executor, transaction);
      assert.equal(context.principal.userId, ADMIN_ID);
      assert.equal(policyId, POLICY_ID);
      assert.deepEqual(input, { reference: "WIRE-123", status: "paid" });
      timestamps.push(changedAt);
      events.push("set");
    },
    async sync(executor, context, policyId, paid, _logger, changedAt) {
      assert.equal(executor, transaction);
      assert.equal(context.principal.userId, ADMIN_ID);
      assert.equal(policyId, POLICY_ID);
      assert.equal(paid, true);
      timestamps.push(changedAt);
      events.push("sync");
      return { associationCount: 1, paySheetIds: [SHEET_ID] };
    },
  };
  const changedAt = new Date("2026-07-11T12:00:00.000Z");
  const logs: LogContext[] = [];
  const result = await changeMgaPayableState(
    database,
    adminContext(),
    POLICY_ID,
    { reference: "  WIRE-123  ", status: "paid" },
    capturingLogger(logs),
    changedAt,
    operations,
  );

  assert.deepEqual(events, ["begin", "set", "sync", "get", "commit"]);
  assert.deepEqual(timestamps, [changedAt, changedAt]);
  assert.deepEqual(result.placement, {
    associationCount: 1,
    paySheetIds: [SHEET_ID],
  });
  assert.equal(JSON.stringify(logs).includes("WIRE-123"), false);
});

test("MGA payable coordinator rolls back when placement fails", async () => {
  const events: string[] = [];
  const database = fakeDatabase(events, {} as never);
  const operations: MgaPayableStateOperations = {
    async get() {
      events.push("get");
      return { policy: { id: POLICY_ID } } as MgaPayableSourceItem;
    },
    async set() {
      events.push("set");
    },
    async sync() {
      events.push("sync");
      throw { code: "55000" };
    },
  };

  await assert.rejects(
    changeMgaPayableState(
      database,
      adminContext(),
      POLICY_ID,
      { status: "paid" },
      capturingLogger([]),
      new Date("2026-07-11T12:00:00.000Z"),
      operations,
    ),
    MgaPayableStateConflictError,
  );
  assert.deepEqual(events, ["begin", "set", "sync", "rollback"]);
});

function fakeDatabase(events: string[], transaction: never): AuthDatabase {
  return {
    async transaction(callback: (executor: never) => Promise<unknown>) {
      events.push("begin");
      try {
        const result = await callback(transaction);
        events.push("commit");
        return result;
      } catch (error) {
        events.push("rollback");
        throw error;
      }
    },
  } as unknown as AuthDatabase;
}

function adminContext(): AuthorizedRequestContext {
  return {
    principal: {
      capabilities: ["admin"],
      staffRole: null,
      userActive: true,
      userId: ADMIN_ID,
    },
  };
}

function capturingLogger(contexts: LogContext[]): AppLogger {
  return {
    error(_message, context = {}) {
      contexts.push(context);
    },
    info(_message, context = {}) {
      contexts.push(context);
    },
    warn(_message, context = {}) {
      contexts.push(context);
    },
  };
}
