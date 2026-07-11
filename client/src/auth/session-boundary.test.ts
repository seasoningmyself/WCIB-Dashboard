import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLogoutAction,
  createSessionBoundary,
  safeInternalReturnPath,
  type SessionEndEvent,
} from "./session-boundary.js";

test("session ending is idempotent and clears every sensitive cache first", () => {
  const order: string[] = [];
  const events: SessionEndEvent[] = [];
  const boundary = createSessionBoundary((event) => {
    order.push("ended");
    events.push(event);
  });
  const financialCache = { value: "private-financial-payload" };
  boundary.registerSensitiveCleanup(() => {
    financialCache.value = "";
    order.push("financial-cleared");
  });
  boundary.registerSensitiveCleanup(() => {
    order.push("failing-cleanup");
    throw new Error("cleanup failure");
  });
  boundary.registerSensitiveCleanup(() => order.push("queries-cleared"));
  boundary.beginSession();

  assert.equal(
    boundary.endSession("expired", "/pay-sheets?month=private"),
    true,
  );
  assert.equal(boundary.endSession("expired", "/policy-ledger"), false);
  assert.equal(financialCache.value, "");
  assert.deepEqual(order, [
    "financial-cleared",
    "failing-cleanup",
    "queries-cleared",
    "ended",
  ]);
  assert.deepEqual(events, [
    { reason: "expired", returnPath: "/pay-sheets" },
  ]);
});

test("manual logout clears locally once even when the endpoint fails", async () => {
  let calls = 0;
  let ended = 0;
  const boundary = createSessionBoundary(() => {
    ended += 1;
  });
  boundary.beginSession();
  const action = createLogoutAction(async () => {
    calls += 1;
    throw new Error("network unavailable");
  }, boundary);

  assert.equal(action.run(), true);
  assert.equal(action.run(), false);
  assert.equal(ended, 1);
  assert.equal(calls, 1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(action.isPending(), false);
});

test("return paths accept internal paths and reject open redirects", () => {
  assert.equal(
    safeInternalReturnPath("/my-items?draft=private"),
    "/my-items",
  );
  assert.equal(
    safeInternalReturnPath("/my-commissions/"),
    "/my-commissions",
  );
  assert.equal(safeInternalReturnPath("https://outside.example"), null);
  assert.equal(safeInternalReturnPath("//outside.example/path"), null);
  assert.equal(safeInternalReturnPath("my-items"), null);
});
