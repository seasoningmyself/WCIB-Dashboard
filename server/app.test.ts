import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { Duplex } from "node:stream";
import { test } from "node:test";
import { z } from "zod";
import { createApp } from "./app.js";
import { asyncRoute, type UnexpectedErrorEvent } from "./http/errors.js";

class MemorySocket extends Duplex {
  readonly chunks: Buffer[] = [];

  _read(): void {}

  _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding),
    );
    callback();
  }
}

async function request(
  path: string,
  app = createApp(),
): Promise<{
  body: unknown;
  headers: ReturnType<ServerResponse["getHeaders"]>;
  statusCode: number;
}> {
  const socket = new MemorySocket();
  const nodeSocket = socket as unknown as Socket;
  const req = new IncomingMessage(nodeSocket);
  const res = new ServerResponse(req);

  req.method = "GET";
  req.url = path;
  req.headers = { host: "localhost" };
  res.assignSocket(nodeSocket);

  const finished = new Promise<void>((resolve, reject) => {
    res.once("finish", resolve);
    res.once("error", reject);
  });

  app(req, res);
  await finished;

  const rawResponse = Buffer.concat(socket.chunks).toString("utf8");
  const body = rawResponse.split("\r\n\r\n", 2)[1];

  return {
    body: JSON.parse(body),
    headers: res.getHeaders(),
    statusCode: res.statusCode,
  };
}

test("GET /api returns backend status", async () => {
  const response = await request("/api");

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    name: "WCIB Dashboard API",
    status: "ok",
  });
});

test("GET /health reports process liveness without checking dependencies", async () => {
  let readinessChecks = 0;
  const app = createApp({
    readinessCheck: async () => {
      readinessChecks += 1;
      throw new Error("DATABASE_URL=must-not-be-logged");
    },
  });

  const response = await request("/health", app);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { status: "ok" });
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(readinessChecks, 0);
});

test("health checks remain independent of session storage", async () => {
  let sessionLookups = 0;
  const app = createApp({
    sessionMiddleware(_req, _res, next) {
      sessionLookups += 1;
      next();
    },
  });

  await request("/health", app);
  assert.equal(sessionLookups, 0);

  await request("/api", app);
  assert.equal(sessionLookups, 1);
});

test("production proxy trust can be enabled before secure cookies", () => {
  const app = createApp({ trustProxy: true });

  assert.equal(app.get("trust proxy"), 1);
});

test("GET /ready reports readiness after the database check passes", async () => {
  let readinessChecks = 0;
  const app = createApp({
    readinessCheck: async () => {
      readinessChecks += 1;
    },
  });

  const response = await request("/ready", app);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { status: "ready" });
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(readinessChecks, 1);
});

test("GET /ready fails safely when the database is unavailable", async () => {
  const app = createApp({
    readinessCheck: async () => {
      throw new Error("password authentication failed for private-password");
    },
  });

  const response = await request("/ready", app);

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { status: "unavailable" });
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(JSON.stringify(response).includes("private-password"), false);
});

test("GET /ready is predictable before a readiness dependency is configured", async () => {
  const response = await request("/ready");

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { status: "unavailable" });
  assert.equal(response.headers["cache-control"], "no-store");
});

test("unknown routes use the standard API error shape", async () => {
  const response = await request("/missing");

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, {
    error: { code: "not_found", message: "Route not found" },
  });
});

test("validation errors use the standard API error shape", async () => {
  const app = createApp({
    registerRoutes(routes) {
      routes.get(
        "/api/validate",
        { public: true, reason: "Test validation error handling" },
        asyncRoute(async () => {
          z.object({ email: z.string().email() }).parse({ email: "invalid" });
        }),
      );
    },
  });
  const response = await request("/api/validate", app);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, {
    error: {
      code: "validation_error",
      details: [{ field: "email", message: "Invalid email" }],
      message: "Request validation failed",
    },
  });
});

test("unexpected errors return a generic response and safe log event", async () => {
  const events: UnexpectedErrorEvent[] = [];
  const failure = new Error("DATABASE_URL=must-not-be-logged");
  let loggedError: unknown;
  const app = createApp({
    logUnexpectedError: (event, error) => {
      events.push(event);
      loggedError = error;
    },
    registerRoutes(routes) {
      routes.get(
        "/api/fail/:sensitiveValue",
        { public: true, reason: "Test unexpected error handling" },
        asyncRoute(async () => {
          throw failure;
        }),
      );
    },
  });
  const response = await request("/api/fail/private-value", app);

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, {
    error: { code: "internal_error", message: "Internal server error" },
  });
  assert.deepEqual(events, [
    {
      errorType: "Error",
      event: "unhandled_request_error",
      method: "GET",
      route: "/api/fail/:sensitiveValue",
      statusCode: 500,
    },
  ]);
  assert.equal(JSON.stringify(events).includes("private-value"), false);
  assert.equal(JSON.stringify(events).includes("DATABASE_URL"), false);
  assert.equal(loggedError, failure);
});
