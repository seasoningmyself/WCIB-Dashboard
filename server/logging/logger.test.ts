import assert from "node:assert/strict";
import { test } from "node:test";
import {
  StructuredLogger,
  type ErrorTrackerContext,
  type LogLevel,
} from "./logger.js";
import { REDACTED_LOG_VALUE } from "./redact.js";

test("StructuredLogger writes deterministic newline-ready JSON records", () => {
  const output: Array<{ level: LogLevel; line: string }> = [];
  const logger = new StructuredLogger({
    clock: () => new Date("2026-07-09T12:34:56.000Z"),
    write: (line, level) => output.push({ level, line }),
  });

  logger.info("Server started", { event: "server_started", port: 5000 });

  assert.deepEqual(output, [
    {
      level: "info",
      line: JSON.stringify({
        timestamp: "2026-07-09T12:34:56.000Z",
        level: "info",
        message: "Server started",
        context: { event: "server_started", port: 5000 },
      }),
    },
  ]);
  assert.equal(output[0]?.line.includes("\n"), false);
});

test("StructuredLogger protects local output and uses the Sentry-shaped seam", () => {
  const lines: string[] = [];
  const captures: Array<{ context: ErrorTrackerContext; error: unknown }> = [];
  const thrown = new Error("DATABASE_URL=private-database-url");
  const logger = new StructuredLogger({
    clock: () => new Date("2026-07-09T12:34:56.000Z"),
    errorTracker: {
      captureException: (error, context) => captures.push({ context, error }),
    },
    write: (line) => lines.push(line),
  });

  logger.error(
    "Unhandled request error",
    {
      authorization: "Bearer private-token",
      event: "unhandled_request_error",
      premiumTotal: 4_200,
      route: "/api/policies/:policyId",
      statusCode: 500,
    },
    thrown,
  );

  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.includes("private-database-url"), false);
  assert.equal(lines[0]?.includes("private-token"), false);
  assert.equal(lines[0]?.includes("4200"), false);
  assert.deepEqual(JSON.parse(lines[0] ?? "{}").context, {
    authorization: REDACTED_LOG_VALUE,
    errorType: "Error",
    event: "unhandled_request_error",
    premiumTotal: REDACTED_LOG_VALUE,
    route: "/api/policies/:policyId",
    statusCode: 500,
  });
  assert.equal(captures[0]?.error, thrown);
  assert.deepEqual(captures[0]?.context, {
    extra: {
      authorization: REDACTED_LOG_VALUE,
      errorType: "Error",
      event: "unhandled_request_error",
      premiumTotal: REDACTED_LOG_VALUE,
      route: "/api/policies/:policyId",
      statusCode: 500,
    },
    level: "error",
    tags: {
      errorType: "Error",
      event: "unhandled_request_error",
      route: "/api/policies/:policyId",
      statusCode: "500",
    },
  });
});

test("StructuredLogger contains error tracker adapter failures", () => {
  const lines: string[] = [];
  const logger = new StructuredLogger({
    clock: () => new Date("2026-07-09T12:34:56.000Z"),
    errorTracker: {
      captureException() {
        throw new Error("tracker secret");
      },
    },
    write: (line) => lines.push(line),
  });

  assert.doesNotThrow(() => logger.error("Failure", {}, new Error("private")));
  assert.equal(lines.length, 2);
  assert.equal(lines[1]?.includes("tracker secret"), false);
  assert.equal(JSON.parse(lines[1] ?? "{}").level, "warn");
});
