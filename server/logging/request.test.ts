import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { NextFunction, Request, Response } from "express";
import type { AppLogger, LogContext } from "./logger.js";
import { createRequestLoggingMiddleware } from "./request.js";

interface LogCall {
  context?: LogContext;
  level: "error" | "info" | "warn";
  message: string;
}

function recordingLogger(calls: LogCall[]): AppLogger {
  return {
    error: (message, context) => calls.push({ context, level: "error", message }),
    info: (message, context) => calls.push({ context, level: "info", message }),
    warn: (message, context) => calls.push({ context, level: "warn", message }),
  };
}

function responseWithStatus(statusCode: number): {
  emitter: EventEmitter;
  response: Response;
} {
  const emitter = new EventEmitter();
  const response = emitter as unknown as Response;
  response.statusCode = statusCode;
  return { emitter, response };
}

test("request logging records a safe route template and bounded metadata", () => {
  const calls: LogCall[] = [];
  const times = [100, 137];
  const middleware = createRequestLoggingMiddleware(recordingLogger(calls), {
    now: () => times.shift() ?? 137,
  });
  const request = {
    baseUrl: "",
    body: { premiumTotal: 4_200 },
    headers: { authorization: "Bearer private-token" },
    method: "GET",
    originalUrl: "/api/policies/private-policy?email=person@example.com",
    route: { path: "/api/policies/:policyId" },
  } as unknown as Request;
  const { emitter, response } = responseWithStatus(200);

  middleware(request, response, (() => {}) as NextFunction);
  emitter.emit("finish");

  assert.deepEqual(calls, [
    {
      context: {
        durationMs: 37,
        event: "http_request_completed",
        method: "GET",
        route: "/api/policies/:policyId",
        statusCode: 200,
      },
      level: "info",
      message: "HTTP request completed",
    },
  ]);
  const serialized = JSON.stringify(calls);
  assert.equal(serialized.includes("private-policy"), false);
  assert.equal(serialized.includes("private-token"), false);
  assert.equal(serialized.includes("person@example.com"), false);
  assert.equal(serialized.includes("4200"), false);
});

test("request logging warns for unmatched 4xx responses", () => {
  const calls: LogCall[] = [];
  const middleware = createRequestLoggingMiddleware(recordingLogger(calls), {
    now: () => 10,
  });
  const request = { baseUrl: "", method: "GET" } as Request;
  const { emitter, response } = responseWithStatus(404);

  middleware(request, response, (() => {}) as NextFunction);
  emitter.emit("finish");

  assert.equal(calls[0]?.level, "warn");
  assert.equal(calls[0]?.context?.route, "unmatched");
});

test("request logging leaves 5xx reporting to the error logger", () => {
  const calls: LogCall[] = [];
  const middleware = createRequestLoggingMiddleware(recordingLogger(calls));
  const request = { baseUrl: "", method: "GET" } as Request;
  const { emitter, response } = responseWithStatus(500);

  middleware(request, response, (() => {}) as NextFunction);
  emitter.emit("finish");

  assert.deepEqual(calls, []);
});
